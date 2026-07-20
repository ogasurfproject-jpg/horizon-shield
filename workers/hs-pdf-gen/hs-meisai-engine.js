// ============================================================
// HS-MEISAI-ENGINE v1 — 見積書明細診断エンジン (Workers互換・依存ゼロ)
// v1: 本家plan版(逆見積もり診断)デザイン完全ミラー / IPAGothic / OTS表示 /
//     諸経費行の判定同期 / R5重複抑制 / 客向けコピー整理
// ============================================================

function hsMzNorm(s) {
  if (!s) return "";
  var t = String(s);
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  t = t.replace(/[\s\u3000]+/g, "");
  return t;
}

var HS_MZ_UNIT_MAP = { "平米": "㎡", "m2": "㎡", "M2": "㎡", "㎡": "㎡", "m": "m", "ｍ": "m", "メートル": "m", "枚": "枚", "本": "本", "個": "個", "箇所": "箇所", "式": "式", "缶": "缶", "袋": "袋", "巻": "巻", "箱": "箱", "台": "台", "人工": "人工", "回": "回", "立米": "m3", "各種": "各種" };

function hsMzUnit(u) { return HS_MZ_UNIT_MAP[hsMzNorm(u)] || hsMzNorm(u); }

function hsMzBuildMatcher(bench) {
  var entries = [];
  bench.items.forEach(function (it) {
    it.aliases.forEach(function (a) { entries.push({ key: hsMzNorm(a), code: it.code, item: it }); });
  });
  entries.sort(function (a, b) { return b.key.length - a.key.length; });
  var fams = [];
  bench.families.forEach(function (f) {
    if (f.family) f.fallback_terms.forEach(function (t) { fams.push({ key: hsMzNorm(t), family: f.family }); });
  });
  fams.sort(function (a, b) { return b.key.length - a.key.length; });
  return function (desc) {
    var d = hsMzNorm(desc);
    for (var i = 0; i < entries.length; i++) if (d.indexOf(entries[i].key) >= 0) return { kind: "item", code: entries[i].code, item: entries[i].item };
    for (var j = 0; j < fams.length; j++) if (d.indexOf(fams[j].key) >= 0) return { kind: "family", family: fams[j].family };
    return { kind: "none" };
  };
}

function hsMzGates(ex) {
  var g = { errors: [], warns: [], pass: false };
  var items = ex.rows.filter(function (r) { return r.type === "item"; });
  items.forEach(function (r) {
    var calc = r.qty * r.unit_price;
    if (Math.abs(calc - r.amount) > 0.5) g.errors.push("G1 行検算NG No." + r.no + ": " + r.qty + "×" + r.unit_price + "≠" + r.amount);
  });
  var sum = items.reduce(function (s, r) { return s + r.amount; }, 0);
  if (Math.round(sum) !== ex.doc.subtotal_ex_tax) g.errors.push("G2 Σ明細 " + Math.round(sum) + " ≠ 小計 " + ex.doc.subtotal_ex_tax);
  var tax = Math.round(ex.doc.subtotal_ex_tax * ex.doc.tax_rate_pct / 100);
  if (tax !== ex.doc.tax) g.errors.push("G3 税額NG");
  if (ex.doc.subtotal_ex_tax + ex.doc.tax !== ex.doc.total_inc_tax) g.errors.push("G3 総額NG");
  var pt = ex.doc.payment_terms || [];
  if (pt.length) {
    var sa = pt.reduce(function (s, p) { return s + p.amount; }, 0);
    var sp = pt.reduce(function (s, p) { return s + p.pct; }, 0);
    if (sa !== ex.doc.total_inc_tax) g.errors.push("G4 支払条件Σ " + sa + " ≠ 総額");
    if (Math.abs(sp - 100) > 0.01) g.errors.push("G4 支払比率Σ " + sp + "%");
    var front = pt.filter(function (p) { return /契約時|着手時|着工時/.test(p.timing); }).reduce(function (s, p) { return s + p.pct; }, 0);
    g.front_load_pct = front;
    if (front >= 50) g.warns.push("着工前受領比率 " + front + "%(高め・出来高払いの交渉余地)");
    pt.forEach(function (p) { if (p.amount_printed) g.warns.push("原本印字と推定不一致: " + p.timing + " 印字" + p.amount_printed); });
  }
  g.sum_items = Math.round(sum);
  g.pass = g.errors.length === 0;
  return g;
}

function hsMeisaiAudit(ex, bench, opts) {
  opts = opts || {};
  var region = opts.region || "all";
  var mult = (bench.souba_db_anchor.region_multipliers[region] || 1);
  var kappa = bench.souba_db_anchor.calibration.kappa_gaiheki || 1;
  var eff = kappa * mult;
  var match = hsMzBuildMatcher(bench);
  var gates = hsMzGates(ex);
  var findings = [];
  var rowsOut = [];
  var isshikiTotal = 0, keihiTotal = 0, overCand = 0;
  var keihiRowIdx = [];
  var isshikiOkCodes = { mune_bankin_hoshu: 1, haizai: 1, shokeihi: 1 };
  var coreCodes = { ashiba: 1, sealing_uchikae: 1, sealing_mashiuchi: 1, uwanuri_silicon: 1, uwanuri_radical: 1, uwanuri_fusso: 1, uwanuri_muki: 1, uwanuri_urethane: 1, shitanuri: 1 };
  var lex = /(足場代?(無料|サービス))|今日(だけ|契約)|本日限り|モニター価格|キャンペーン(値引き|価格)|訪問販売/;
  var esc = /(価格上昇|高騰|資材.*(上昇|値上)|戦争影響)/;
  var curSection = null;
  var subtotal = ex.doc.subtotal_ex_tax;

  var qm = null;
  if (opts.category === "gaiheki_tosou" && opts.tsubo) {
    var nobe = opts.tsubo * bench.quantity_models.nobeyuka_m2_per_tsubo;
    var wallMid = nobe * 1.2;
    qm = { wall: wallMid, scaf: wallMid * 1.55, seal: wallMid * 1.55 };
  }

  ex.rows.forEach(function (r) {
    if (r.type === "section") {
      curSection = r;
      if (esc.test(r.description)) findings.push({ level: "confirm", rule: "R7", no: r.no, msg: "市況転嫁の主張あり(『" + r.description + "』)。根拠の説明を確認事項に" });
      if (lex.test(r.description)) findings.push({ level: "alert", rule: "R6", no: r.no, msg: "警戒語彙: " + r.description });
      return;
    }
    var m = match(r.description);
    var verdict = "ok", reason = "";
    var unit = hsMzUnit(r.unit);
    if (lex.test(r.description)) { findings.push({ level: "alert", rule: "R6", no: r.no, msg: "警戒語彙: " + r.description }); }
    if (esc.test(r.description)) { findings.push({ level: "confirm", rule: "R7", no: r.no, msg: "No." + r.no + " 市況転嫁の主張。根拠確認を" }); }

    if (unit === "式") {
      isshikiTotal += r.amount;
      var codeOk = (m.kind === "item" && isshikiOkCodes[m.code]);
      var isKeihi = (m.kind === "item" && m.code === "shokeihi") || (curSection && /諸経費/.test(curSection.description));
      if (isKeihi) { keihiTotal += r.amount; keihiRowIdx.push(rowsOut.length); }
      if (!codeOk && !isKeihi && r.amount >= 50000) { verdict = "watch"; reason = "一式" + Math.round(r.amount / 10000) + "万円 — 内訳の提出を求める"; }
      if (m.kind === "item" && coreCodes[m.code]) { verdict = "alert"; reason = "中核工程が一式(数量根拠なし)"; }
    } else if (m.kind === "item" && m.item.bench && hsMzUnit(m.item.unit) === unit && r.qty > 0 && opts.category === "gaiheki_tosou") {
      var price = r.unit_price;
      var d = hsMzNorm(r.description);
      var isTwoCoat = /中塗り\+上塗り|2回計/.test(m.item.canonical);
      var single = isTwoCoat && ((d.indexOf("中塗") >= 0) !== (d.indexOf("上塗") >= 0));
      if (single) price = price * 2;
      var b = m.item.bench;
      var eMax = b.max * eff, eMin = b.min * eff, eDanger = b.danger * eff;
      if (price > eDanger) { verdict = "alert"; reason = "危険水準超(" + Math.round(price) + " > " + Math.round(eDanger) + ")"; }
      else if (price > eMax * 1.2) { verdict = "alert"; reason = "適正上限+20%超(上限" + Math.round(eMax) + ")"; }
      else if (price > eMax) { verdict = "watch"; reason = "適正上限超(上限" + Math.round(eMax) + ", +" + Math.round(100 * (price - eMax) / eMax) + "%)"; }
      else if (price < eMin * 0.7) { verdict = "watch"; reason = "安すぎ(下限" + Math.round(eMin) + "比-30%超。手抜き・後出し増額の兆候)"; }
      if (price > eMax) {
        var capUnit = single ? eMax / 2 : eMax;
        overCand += Math.max(0, r.amount - r.qty * capUnit);
      }
      if (qm && m.code !== "mesh_sheet") {
        var ref = null;
        if (m.code === "ashiba") ref = qm.scaf;
        else if (m.code === "sealing_uchikae" || m.code === "sealing_mashiuchi") ref = qm.seal;
        else if (["kouatsu_senjo", "yojo", "shitanuri", "uwanuri_silicon", "uwanuri_radical", "uwanuri_fusso", "uwanuri_muki", "uwanuri_urethane"].indexOf(m.code) >= 0) ref = qm.wall;
        if (ref && Math.abs(r.qty - ref) / ref > 0.30) {
          findings.push({ level: "watch", rule: "R5", no: r.no, msg: "No." + r.no + " 数量" + r.qty + unit + " がモデル推定" + Math.round(ref) + "から±30%超乖離(水増し/過小の両面確認)" });
        }
      }
    } else {
      if (verdict === "ok") {
        if (m.kind === "item" && opts.category !== "gaiheki_tosou") { verdict = "confirm"; reason = "名寄せ一致(" + m.code + ")だがスコープ外カテゴリ — 単価判定保留"; }
        else if (m.kind === "family") { verdict = "confirm"; reason = "分類のみ一致(" + m.family + ")・グレード/工法不明 — 要確認"; }
        else if (m.kind === "item") { verdict = "confirm"; reason = "単位不整合または数量なし — 要確認"; }
        else { verdict = "confirm"; reason = "名寄せ未マッチ — 要確認(スコープ外項目)"; }
      }
    }
    rowsOut.push({ no: r.no, description: r.description, qty: r.qty, unit: r.unit, unit_price: r.unit_price, amount: r.amount, matched: m.kind === "item" ? m.code : (m.kind === "family" ? "family:" + m.family : null), verdict: verdict, reason: reason });
    if (verdict === "watch" || verdict === "alert") findings.push({ level: verdict, rule: unit === "式" ? "R3" : "R1", no: r.no, msg: "No." + r.no + " " + r.description.slice(0, 24) + " — " + reason });
  });

  var isshikiPct = 100 * isshikiTotal / subtotal;
  if (isshikiPct > 35) findings.push({ level: "watch", rule: "R3", msg: "一式合計が小計の" + isshikiPct.toFixed(1) + "%(>35%)" });
  var keihiPct = 100 * keihiTotal / subtotal;
  var keihiLevel = keihiPct <= 16 ? "ok" : (keihiPct <= 20 ? "watch" : "alert");
  if (keihiLevel !== "ok") {
    findings.push({ level: keihiLevel, rule: "R4", msg: "諸経費率 " + keihiPct.toFixed(1) + "%(目安10〜16%・20%超は内訳提出を求める水準)" });
    keihiRowIdx.forEach(function (i) {
      rowsOut[i].verdict = keihiLevel;
      rowsOut[i].reason = "諸経費率 " + keihiPct.toFixed(1) + "%(目安10〜16%)";
    });
  }

  var totalAnchor = null;
  if (opts.category === "gaiheki_tosou" && opts.tsubo && bench.souba_db_anchor.gaiheki_isshiki_silicon[opts.tsubo + "tsubo"]) {
    var a = bench.souba_db_anchor.gaiheki_isshiki_silicon[opts.tsubo + "tsubo"];
    var lo = a[0] * mult, av = a[1] * mult, hi = a[2] * mult;
    var v = subtotal <= hi ? (subtotal < lo ? "watch" : "ok") : (subtotal > hi * 1.2 ? "alert" : "watch");
    totalAnchor = { range: [Math.round(lo), Math.round(av), Math.round(hi)], verdict: v, vs_avg_pct: Math.round(1000 * (subtotal - av) / av) / 10 };
    if (v !== "ok") findings.push({ level: v, rule: "TOTAL", msg: "総額(税抜)" + subtotal.toLocaleString() + "円 vs 適正 " + Math.round(lo).toLocaleString() + "〜" + Math.round(hi).toLocaleString() + "円(" + region + "補正) 平均比" + (totalAnchor.vs_avg_pct > 0 ? "+" : "") + totalAnchor.vs_avg_pct + "%" });
  }
  (ex.doc.doc_notes || []).forEach(function (n) {
    if (lex.test(n)) findings.push({ level: "alert", rule: "R6", msg: "備考に警戒語彙: " + n });
    if (esc.test(n)) findings.push({ level: "confirm", rule: "R7", msg: "備考に市況転嫁の主張: 根拠確認を" });
  });

  // findings dedupe
  var seen = {};
  findings = findings.filter(function (f) {
    var k = f.level + "|" + f.rule + "|" + f.msg;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });

  var counts = { ok: 0, watch: 0, alert: 0, confirm: 0 };
  rowsOut.forEach(function (r) { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
  return {
    gates: gates, rows: rowsOut, findings: findings, total_anchor: totalAnchor,
    summary: { region: region, kappa: kappa, counts: counts, isshiki_pct: Math.round(isshikiPct * 10) / 10, keihi_pct: Math.round(keihiPct * 10) / 10, keihi_level: keihiLevel, front_load_pct: gates.front_load_pct || null, over_candidate_yen: Math.round(overCand) }
  };
}

// ---- 紺×金 診断書HTML(本家plan版デザイン完全ミラー / IPAGothic) ----
function hsGenerateEstimateAuditHTML(ex, audit, meta) {
  meta = meta || {};
  function h(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function yen(n) { return n == null ? "" : Math.round(n).toLocaleString(); }
  var vLabel = { ok: "妥当", watch: "要注意", alert: "過大疑い", confirm: "要確認" };
  var vColor = { ok: "#2e7d32", watch: "#b26a00", alert: "#b02a2a", confirm: "#888" };
  var ruleLabel = { R1: "単価", R2: "構成比", R3: "一式", R4: "諸経費", R5: "数量", R6: "営業手口", R7: "市況転嫁", TOTAL: "総額", G: "検算" };
  var worst = "ok";
  if ((audit.summary.counts.watch || 0) > 0 || audit.summary.keihi_level === "watch") worst = "watch";
  if ((audit.summary.counts.alert || 0) > 0 || audit.summary.keihi_level === "alert" || (audit.total_anchor && audit.total_anchor.verdict === "alert")) worst = "alert";
  var worstLabel = { ok: "適正レンジ内", watch: "要注意あり", alert: "過大疑いあり" };

  var rowsHtml = "";
  audit.rows.forEach(function (r) {
    var bg = r.verdict === "alert" ? "#fbeaea" : (r.verdict === "watch" ? "#fbf4e2" : "#fff");
    rowsHtml += "<tr style='background:" + bg + "'><td class='c'>" + r.no + "</td><td>" + h(r.description) + "</td><td class='n'>" + (r.qty == null ? "" : r.qty) + " " + h(r.unit || "") + "</td><td class='n'>" + yen(r.unit_price) + "</td><td class='n'>" + yen(r.amount) + "</td><td class='c' style='color:" + vColor[r.verdict] + ";font-weight:700'>" + vLabel[r.verdict] + "</td><td class='rs'>" + h(r.reason) + "</td></tr>";
  });

  var fHtml = "";
  audit.findings.forEach(function (f) {
    var c = f.level === "alert" ? "#b02a2a" : (f.level === "watch" ? "#b26a00" : "#555");
    fHtml += "<li><span class='tag'>" + (ruleLabel[f.rule] || f.rule) + "</span><span style='color:" + c + "'>" + h(f.msg) + "</span></li>";
  });

  var gatesLine = audit.gates.pass
    ? "整合検算 PASS — 明細" + audit.rows.length + "行の数量×単価・合計・税・支払条件が一致"
    : "整合検算 FAIL — " + h(audit.gates.errors.join(" / "));

  return "<!DOCTYPE html><html lang='ja'><head><meta charset='UTF-8'><style>" +
    "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:IPAGothic,sans-serif;background:#fff;color:#1a1a2e;line-height:1.7}" +
    ".cover{background:linear-gradient(160deg,#0a0e1a 0%,#1a1a2e 40%,#0f3460 100%);color:#fff;height:100vh;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:60px;page-break-after:always}" +
    ".cover::before{content:'';position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(201,162,39,0.12) 0%,transparent 70%)}" +
    ".cover::after{content:'';position:absolute;bottom:-100px;left:-100px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(15,52,96,0.6) 0%,transparent 70%)}" +
    ".cover-stamp{position:absolute;top:40px;right:40px;z-index:10;width:100px;height:100px;border-radius:50%;border:2.5px solid #c9a227;background:rgba(201,162,39,0.08);display:flex;flex-direction:column;justify-content:center;align-items:center;box-shadow:0 0 20px rgba(201,162,39,0.2)}" +
    ".cover-stamp-text{font-size:9px;font-weight:700;color:#c9a227;letter-spacing:2px}.cover-stamp-check{font-size:20px;color:#c9a227;line-height:1}" +
    ".cover-eyebrow{background:rgba(201,162,39,0.15);border:1px solid rgba(201,162,39,0.4);border-radius:30px;padding:6px 20px;font-size:10px;letter-spacing:3px;color:#c9a227;margin-bottom:32px;z-index:1}" +
    ".cover-title{font-size:42px;font-weight:900;text-align:center;line-height:1.2;margin-bottom:16px;z-index:1}.cover-title em{color:#c9a227;font-style:normal;display:block}" +
    ".cover-sub{font-size:14px;color:rgba(255,255,255,0.6);text-align:center;margin-bottom:48px;z-index:1;line-height:1.8}" +
    ".cover-case{background:rgba(255,255,255,0.05);border:1px solid rgba(201,162,39,0.5);border-radius:16px;padding:24px 40px;text-align:center;margin-bottom:40px;z-index:1;max-width:560px;width:100%}" +
    ".cover-case-label{font-size:10px;color:#c9a227;letter-spacing:3px;margin-bottom:10px}.cover-case-val{font-size:17px;font-weight:700;line-height:1.5}" +
    ".cover-verdict{font-size:13px;letter-spacing:2px;border:1px solid rgba(201,162,39,0.5);border-radius:30px;padding:8px 28px;z-index:1;margin-bottom:24px}" +
    ".cover-meta{font-size:12px;color:rgba(255,255,255,0.5);z-index:1}" +
    ".cover-footer{position:absolute;bottom:32px;font-size:10px;color:rgba(255,255,255,0.3);text-align:center;z-index:1}" +
    ".page{padding:52px 52px 40px;position:relative}" +
    ".page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid #eee}" +
    ".page-logo{font-size:11px;font-weight:700;color:#0f3460;letter-spacing:2px}.page-num{font-size:10px;color:#999}" +
    ".section-title{font-size:11px;color:#c9a227;font-weight:700;letter-spacing:3px;margin:26px 0 10px;text-transform:uppercase}" +
    ".cards{display:flex;gap:12px;margin-bottom:6px}" +
    ".card{flex:1;border:1px solid #e6e2d6;border-left:4px solid #c9a227;border-radius:8px;padding:12px 14px}" +
    ".card .k{font-size:9.5px;color:#888;letter-spacing:1px;margin-bottom:4px}.card .v{font-size:17px;font-weight:900;color:#0f3460}.card .s{font-size:10px;color:#777;margin-top:2px}" +
    "table{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}" +
    "thead{display:table-header-group}th{background:#0f3460;color:#fff;padding:6px 5px;font-weight:700;border:1px solid #0f3460}" +
    "td{padding:5px;border:1px solid #ddd;vertical-align:top}.n{text-align:right;white-space:nowrap}.c{text-align:center;white-space:nowrap}.rs{color:#555;font-size:9.5px}" +
    "ol.findings{margin:4px 0 0 18px;font-size:11px}ol.findings li{margin-bottom:5px}" +
    ".tag{display:inline-block;background:rgba(201,162,39,0.14);color:#8a6d12;border:1px solid rgba(201,162,39,0.5);border-radius:3px;font-size:9px;padding:1px 7px;margin-right:7px;letter-spacing:1px;vertical-align:middle}" +
    ".ptka{border:1px dashed #c9a227;border-radius:8px;padding:10px 14px;font-size:10px;color:#555;background:#fdfbf5}" +
    ".ptka b{color:#0f3460}.mono{font-family:monospace;letter-spacing:1px}" +
    ".gates{font-size:11px;color:#2e7d32;margin-bottom:2px}" +
    ".gates.ng{color:#b02a2a}" +
    ".foot{margin-top:22px;font-size:9px;color:#999;line-height:1.6;border-top:1px solid #eee;padding-top:10px}" +
    "@page{size:A4;margin:0}" +
    "</style></head><body>" +
    // ---- 表紙 ----
    "<div class='cover'>" +
    "<div class='cover-stamp'><div class='cover-stamp-check'>&#10003;</div><div class='cover-stamp-text'>PTKA</div></div>" +
    "<div class='cover-eyebrow'>HORIZON SHIELD — LINE ITEM AUDIT</div>" +
    "<div class='cover-title'>見積書<em>明細診断書</em></div>" +
    "<div class='cover-sub'>項目別の単価・数量・構成を第三者基準で突合し、<br>交渉に使える根拠として刻印します。</div>" +
    "<div class='cover-case'><div class='cover-case-label'>SUBJECT</div><div class='cover-case-val'>" + h(ex.doc.title || "-") + "<br><span style='font-size:12px;font-weight:400;color:rgba(255,255,255,0.65)'>見積番号 " + h(ex.doc.estimate_no || "-") + " ／ 税込総額 " + yen(ex.doc.total_inc_tax) + "円</span></div></div>" +
    "<div class='cover-verdict' style='color:" + (worst === "alert" ? "#ff9d9d" : (worst === "watch" ? "#ffd98a" : "#9fd6a8")) + "'>総合所見: " + worstLabel[worst] + "</div>" +
    "<div class='cover-meta'>診断日 " + h(meta.date || "") + " ／ 地域補正 " + h(audit.summary.region) + " ／ bench " + h(meta.benchVersion || "") + "</div>" +
    "<div class='cover-footer'>The HORIZONs株式会社 ／ HORIZON SHIELD — 買い手のための第三者診断</div>" +
    "</div>" +
    // ---- 本文 ----
    "<div class='page'>" +
    "<div class='page-header'><div class='page-logo'>HORIZON SHIELD</div><div class='page-num'>ESTIMATE AUDIT ／ " + h(ex.doc.estimate_no || "-") + "</div></div>" +
    "<div class='section-title'>Summary ／ 総括</div>" +
    "<div class='gates" + (audit.gates.pass ? "" : " ng") + "'>" + gatesLine + "</div>" +
    "<div class='cards'>" +
    "<div class='card'><div class='k'>総額判定" + (audit.total_anchor ? "(適正 " + yen(audit.total_anchor.range[0]) + "〜" + yen(audit.total_anchor.range[2]) + "円)" : "") + "</div><div class='v' style='color:" + (audit.total_anchor ? vColor[audit.total_anchor.verdict] : "#0f3460") + "'>" + (audit.total_anchor ? vLabel[audit.total_anchor.verdict] + " " + (audit.total_anchor.vs_avg_pct > 0 ? "+" : "") + audit.total_anchor.vs_avg_pct + "%" : "対象外") + "</div><div class='s'>" + (audit.total_anchor ? "souba-db平均比" : "スコープ外カテゴリ") + "</div></div>" +
    "<div class='card'><div class='k'>単価超過の過大候補額</div><div class='v' style='color:" + (audit.summary.over_candidate_yen > 0 ? "#b02a2a" : "#0f3460") + "'>約 " + yen(audit.summary.over_candidate_yen) + "円</div><div class='s'>適正上限との差の合計(参考)</div></div>" +
    "<div class='card'><div class='k'>諸経費率(目安10〜16%)</div><div class='v' style='color:" + vColor[audit.summary.keihi_level] + "'>" + audit.summary.keihi_pct + "%</div><div class='s'>一式比率 " + audit.summary.isshiki_pct + "%" + (audit.summary.front_load_pct != null ? " ／ 着工前受領 " + audit.summary.front_load_pct + "%" : "") + "</div></div>" +
    "</div>" +
    (fHtml ? "<div class='section-title'>Findings ／ 指摘・交渉ポイント</div><ol class='findings'>" + fHtml + "</ol>" : "") +
    "<div class='section-title'>Line Item Audit ／ 明細突合表</div>" +
    "<table><thead><tr><th>No.</th><th>摘要</th><th>数量</th><th>単価</th><th>金額</th><th>判定</th><th>根拠</th></tr></thead><tbody>" + rowsHtml + "</tbody></table>" +
    "<div class='section-title'>PTKA ／ 取引前知識刻印</div>" +
    "<div class='ptka'><b>SHA-256:</b> <span class='mono'>" + h(meta.auditHash || "発行時に刻印") + "</span><br><b>OpenTimestamps:</b> " + h(meta.ots || "未刻印") + "</div>" +
    "<div class='foot'>本診断は souba-db(大賀俊勝 実務監修)および明細基準 " + h(meta.benchVersion || "") + " に基づく買い手側の第三者所見であり、工事金額を保証するものではありません。判定原則: 諸経費は総額の10〜16%が目安・『一式』は内訳の提出を求める(建設実務30年)。The HORIZONs株式会社</div>" +
    "</div></body></html>";
}

if (typeof module !== "undefined") module.exports = { hsMeisaiAudit: hsMeisaiAudit, hsGenerateEstimateAuditHTML: hsGenerateEstimateAuditHTML, hsMzGates: hsMzGates };
