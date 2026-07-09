/**
 * HORIZON SHIELD 逆見積もりPDF生成 Worker v11
 * 
 * 技術スタック: Cloudflare Browser Rendering (Puppeteer + Chrome)
 * 日本語: Chrome内蔵フォントで完璧対応
 * 通知: LINE + メール(Resend) + ntfy の3チャネル並列配信
 * 
 * エンドポイント:
 *   GET  /health              - ヘルスチェック
 *   GET  /font-test           - フォント診断(開発用)
 *   POST /generate-test       - PDF生成テスト (開発用)
 *   POST /generate-and-send   - PDF生成+R2保存+3チャネル通知(統合テスト)
 *   POST /webhook/paypay      - PayPay決済完了Webhook (本番)
 *   GET  /pdf/:orderId        - PDFダウンロード
 * 
 * v11 変更点:
 *   - LINE/Email/ntfy の3チャネル並列通知 (Promise.allSettled)
 *   - 顧客通知は LINE+Email の2系統 (LINE ID あり/なし両対応)
 *   - TOshi通知は LINE+Email+ntfy の3系統 (障害耐性↑)
 *   - 法人表記修正: The HORIZONs → The HORIZ音s
 */

import puppeteer from '@cloudflare/puppeteer';

// ============================================================
// 定数
// ============================================================

const SERVICE_FEE = 5500;  // 逆見積書PDF価格

const REGION_LABEL = {
  all: '全国平均',
  kanto: '関東',
  kinki: '近畿',
  chubu: '中部',
  tohoku: '東北',
  other: 'その他',
};

const REGION_MULT = {
  all: 1.00,
  kanto: 1.10,
  kinki: 1.06,
  chubu: 1.00,
  tohoku: 0.95,
  other: 0.93,
};

const OVERCHARGE_THRESHOLDS = {
  cheap: 0.85,
  ok: 1.15,
  warn: 1.30,
};

// ============================================================
// ユーティリティ
// ============================================================

function fmtYen(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 100000000) {
    const oku = abs / 100000000;
    return `${sign}¥${oku.toFixed(1).replace(/\.0$/, '')}億`;
  }

  if (abs >= 10000) {
    const man = abs / 10000;
    if (man === Math.floor(man)) {
      return `${sign}¥${Math.floor(man).toLocaleString()}万`;
    }
    return `${sign}¥${man.toFixed(1)}万`;
  }

  return `${sign}¥${abs.toLocaleString()}`;
}

function fmtDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}年${m}月${dd}日 ${hh}:${mm}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// 診断ロジック
// ============================================================

async function diagnose(params, env) {
  const { koji_type, teiji_kingaku, region = 'all' } = params;

  // souba-db.json 読込
  const sobaObj = await env.PDFS_BUCKET.get('souba-db.json');
  if (!sobaObj) {
    throw new Error('Souba DB not found in R2: souba-db.json');
  }
  const sobaText = await sobaObj.text();
  const sobaData = JSON.parse(sobaText);

  // categories 配列から id で検索
  const item = sobaData.categories?.find(c => c.id === koji_type);
  if (!item) {
    throw new Error(`Unknown koji_type: ${koji_type}`);
  }

  const regionMult = REGION_MULT[region] ?? 1.00;
  const regionLabel = REGION_LABEL[region] ?? '全国';

  const adjMin = Math.round(item.min * regionMult);
  const adjAvg = Math.round(item.avg * regionMult);
  const adjMax = Math.round(item.max * regionMult);
  const adjDanger = Math.round(item.danger * regionMult);

  const ratio = teiji_kingaku / adjAvg;
  const gap = teiji_kingaku - adjAvg;
  const gapPct = Math.round((gap / adjAvg) * 100);

  let status, statusLabel, statusColor;
  if (ratio <= OVERCHARGE_THRESHOLDS.cheap) {
    status = 'cheap';
    statusLabel = '相場より安い';
    statusColor = '#4ade80';
  } else if (ratio <= OVERCHARGE_THRESHOLDS.ok) {
    status = 'ok';
    statusLabel = '適正価格';
    statusColor = '#4ade80';
  } else if (ratio <= OVERCHARGE_THRESHOLDS.warn) {
    status = 'warn';
    statusLabel = '少し高め';
    statusColor = '#fbbf24';
  } else {
    status = 'danger';
    statusLabel = '過剰請求の疑い';
    statusColor = '#ef4444';
  }

  return {
    item,
    koji_name: item.work,
    region,
    regionLabel,
    regionMult,
    teiji_kingaku,
    adjMin,
    adjAvg,
    adjMax,
    adjDanger,
    ratio,
    gap,
    gapPct,
    status,
    statusLabel,
    statusColor,
  };
}

// ============================================================
// 交渉フレーズ生成
// ============================================================

function generateNegotiationPhrases(d) {
  const phrases = [];

  phrases.push(
    `HORIZON SHIELDの相場データベースによると、${d.koji_name}の適正価格は${fmtYen(d.adjMin)}〜${fmtYen(d.adjMax)}、中央値${fmtYen(d.adjAvg)}とのことです。御社の提示額${fmtYen(d.teiji_kingaku)}との差分の根拠をご説明いただけますでしょうか。`
  );

  phrases.push(
    `見積書の内訳に「一式」表記が多く見受けられます。各項目の数量・単価・人工数を明細でご提示ください。特に足場代・諸経費・下地処理費の算出根拠を明確にしていただきたいです。`
  );

  phrases.push(
    `契約前に他社2〜3社の相見積もりを取らせていただきます。御社がもっとも誠実なご提案であることを確認したうえで、正式にお願いしたいと考えております。`
  );

  if (d.status === 'danger') {
    phrases.push(
      `提示額は相場の${Math.round(d.ratio * 100)}%に達しています。この金額では検討できませんので、相場の範囲内で再見積もりをお願いします。難しい場合は契約を見送らせていただきます。`
    );
    phrases.push(
      `HORIZON SHIELD（建設実務経験30年の専門家監修）で査定してもらったところ、「過剰請求の疑い」という診断結果が出ました。適正価格での再見積もりをお願いします。`
    );
  } else if (d.status === 'warn') {
    phrases.push(
      `提示額は相場の中央値を${d.gapPct}%上回っています。差分の明確な理由（使用材料のグレード・特殊な施工条件等）があればご説明いただき、なければ相場水準でご検討ください。`
    );
    phrases.push(
      `HORIZON SHIELD（建設実務経験30年の専門家監修）で査定してもらったところ、「少し高め」という診断結果が出ました。調整のご検討をお願いします。`
    );
  } else {
    phrases.push(
      `提示額は相場範囲内と判断しておりますが、最終確認として内訳の詳細をご提示いただけますでしょうか。`
    );
    phrases.push(
      `HORIZON SHIELD（建設実務経験30年の専門家監修）で査定した結果、「${d.statusLabel}」との診断でした。契約に向けて前向きに検討いたします。`
    );
  }

  return phrases;
}

// ============================================================
// HTML生成
// ============================================================

function generateHTML(d, orderInfo) {
  const phrases = generateNegotiationPhrases(d);
  const now = fmtDate();
  const regionText = d.region === 'all'
    ? '全国平均'
    : `${d.regionLabel}（${d.regionMult >= 1 ? '+' : ''}${Math.round((d.regionMult - 1) * 100)}%補正）`;

  const overchargeRate = d.item.overcharge_rate ?? 50;
  const trendText = d.item.trend_val || '±0%';
  const supplement = d.item.note || '';

  // 棒グラフの位置計算
  const minPos = 0;
  const avgPos = ((d.adjAvg - d.adjMin) / (d.adjDanger - d.adjMin)) * 100;
  const maxPos = ((d.adjMax - d.adjMin) / (d.adjDanger - d.adjMin)) * 100;
  const dangerPos = 100;
  const userPos = Math.min(100, Math.max(0, ((d.teiji_kingaku - d.adjMin) / (d.adjDanger - d.adjMin)) * 100));

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>HORIZON SHIELD 交渉用・逆見積書</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  html, body {
    font-family: sans-serif;
    color: #ffffff;
    background: #0f1729;
    font-size: 10pt;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 15mm 18mm;
    background: linear-gradient(180deg, #0f1729 0%, #111c38 100%);
    position: relative;
    page-break-after: always;
  }
  .page:last-child {
    page-break-after: auto;
  }

  /* ヘッダー */
  .header {
    border-bottom: 2px solid #d4af37;
    padding-bottom: 10mm;
    margin-bottom: 8mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .logo {
    font-size: 20pt;
    font-weight: 900;
    color: #f4d03f;
    letter-spacing: 0.05em;
  }
  .subtitle {
    font-size: 11pt;
    color: #9ca3af;
    margin-top: 2mm;
    letter-spacing: 0.1em;
  }
  .doc-title {
    font-size: 16pt;
    font-weight: 700;
    color: #f4d03f;
    margin-top: 3mm;
  }
  .meta-right {
    text-align: right;
    font-size: 9pt;
    color: #9ca3af;
  }
  .meta-right .order-id {
    color: #d4af37;
    font-weight: 600;
  }

  /* セクション */
  .section {
    margin-bottom: 6mm;
  }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #f4d03f;
    border-left: 4px solid #d4af37;
    padding-left: 3mm;
    margin-bottom: 3mm;
  }

  /* 診断対象 */
  .target-grid {
    display: grid;
    grid-template-columns: 40mm 1fr;
    gap: 2mm 5mm;
    background: rgba(255,255,255,0.04);
    padding: 4mm 5mm;
    border-radius: 2mm;
    border: 1px solid rgba(212,175,55,0.3);
  }
  .target-label {
    color: #9ca3af;
    font-size: 9pt;
  }
  .target-value {
    color: #e8e8e8;
    font-size: 11pt;
    font-weight: 500;
  }
  .target-value.big {
    font-size: 14pt;
    font-weight: 700;
    color: #f4d03f;
  }

  /* 診断結果バッジ */
  .status-box {
    background: ${d.statusColor}22;
    border: 2px solid ${d.statusColor};
    border-radius: 2mm;
    padding: 5mm 6mm;
    margin-bottom: 4mm;
  }
  .status-label {
    font-size: 16pt;
    font-weight: 900;
    color: ${d.statusColor};
    margin-bottom: 2mm;
  }
  .status-desc {
    font-size: 10pt;
    color: #e8e8e8;
  }

  /* 相場表示 */
  .price-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4mm;
  }
  .price-table th, .price-table td {
    padding: 2.5mm 4mm;
    text-align: left;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .price-table th {
    color: #9ca3af;
    font-size: 9pt;
    font-weight: 500;
    width: 35%;
  }
  .price-table td {
    color: #e8e8e8;
    font-size: 11pt;
    font-weight: 600;
  }
  .price-min { color: #4ade80; }
  .price-avg { color: #f4d03f; }
  .price-max { color: #e8e8e8; }
  .price-danger { color: #ef4444; }

  /* 棒グラフ */
  .graph-container {
    margin: 4mm 0 6mm 0;
  }
  .graph-bar {
    position: relative;
    height: 12mm;
    background: linear-gradient(to right, #166534 0%, #15803d 25%, #d97706 50%, #dc2626 100%);
    border-radius: 2mm;
    overflow: visible;
  }
  .graph-marker {
    position: absolute;
    top: -4mm;
    transform: translateX(-50%);
    text-align: center;
  }
  .graph-marker-dot {
    width: 3mm;
    height: 3mm;
    background: #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1mm rgba(0,0,0,0.3);
    margin: 0 auto;
  }
  .graph-marker-label {
    font-size: 7pt;
    color: #9ca3af;
    margin-top: 1mm;
    white-space: nowrap;
  }
  .graph-user {
    position: absolute;
    top: -8mm;
    transform: translateX(-50%);
    text-align: center;
  }
  .graph-user-arrow {
    color: #ef4444;
    font-size: 14pt;
    font-weight: 900;
    line-height: 1;
  }
  .graph-user-label {
    background: #ef4444;
    color: #fff;
    padding: 0.5mm 2mm;
    border-radius: 1mm;
    font-size: 8pt;
    font-weight: 700;
    margin-top: 1mm;
    display: inline-block;
  }
  .graph-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 10mm;
    font-size: 8pt;
    color: #9ca3af;
  }

  /* 差分表示 */
  .diff-box {
    background: rgba(239,68,68,0.08);
    border-left: 3px solid #ef4444;
    padding: 3mm 4mm;
    margin-top: 4mm;
    border-radius: 0 2mm 2mm 0;
  }
  .diff-box.ok {
    background: rgba(74,222,128,0.08);
    border-color: #4ade80;
  }
  .diff-box.warn {
    background: rgba(251,191,36,0.08);
    border-color: #fbbf24;
  }
  .diff-label {
    font-size: 9pt;
    color: #9ca3af;
    margin-bottom: 1mm;
  }
  .diff-value {
    font-size: 14pt;
    font-weight: 900;
    color: ${d.statusColor};
  }

  /* 統計情報 */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3mm;
    margin-bottom: 3mm;
  }
  .stats-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    padding: 3mm 4mm;
    border-radius: 2mm;
  }
  .stats-label {
    font-size: 8pt;
    color: #9ca3af;
    margin-bottom: 1mm;
  }
  .stats-value {
    font-size: 14pt;
    font-weight: 700;
    color: #f4d03f;
  }
  .stats-value.red { color: #ef4444; }

  /* 補足 */
  .supplement {
    background: rgba(255,255,255,0.02);
    border: 1px dashed rgba(255,255,255,0.15);
    padding: 3mm 4mm;
    border-radius: 2mm;
    font-size: 9pt;
    color: #9ca3af;
    margin-top: 3mm;
  }

  /* フッター */
  .footer {
    position: absolute;
    bottom: 8mm;
    left: 18mm;
    right: 18mm;
    border-top: 1px solid rgba(212,175,55,0.3);
    padding-top: 3mm;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #6b7280;
  }

  /* 2ページ目：交渉フレーズ */
  .phrase-card {
    background: rgba(255,255,255,0.04);
    border-left: 3px solid #d4af37;
    border-radius: 0 2mm 2mm 0;
    padding: 4mm 5mm;
    margin-bottom: 3mm;
  }
  .phrase-num {
    display: inline-block;
    width: 6mm;
    height: 6mm;
    line-height: 6mm;
    text-align: center;
    background: #d4af37;
    color: #0f1729;
    border-radius: 50%;
    font-weight: 900;
    font-size: 10pt;
    margin-right: 3mm;
  }
  .phrase-text {
    font-size: 10pt;
    line-height: 1.8;
    color: #e8e8e8;
    margin-left: 9mm;
    margin-top: -5mm;
  }

  /* 注意書き */
  .disclaimer {
    background: rgba(239,68,68,0.05);
    border: 1px solid rgba(239,68,68,0.3);
    padding: 5mm 6mm;
    border-radius: 2mm;
    margin-top: 4mm;
  }
  .disclaimer-title {
    font-size: 10pt;
    font-weight: 700;
    color: #f87171;
    margin-bottom: 2mm;
  }
  .disclaimer-text {
    font-size: 8.5pt;
    color: #d1d5db;
    line-height: 1.7;
  }

  /* データソース */
  .sources {
    background: rgba(255,255,255,0.02);
    padding: 4mm 5mm;
    border-radius: 2mm;
    margin-top: 4mm;
  }
  .sources-title {
    font-size: 9pt;
    color: #9ca3af;
    margin-bottom: 2mm;
    font-weight: 600;
  }
  .sources-list {
    font-size: 8pt;
    color: #9ca3af;
    line-height: 1.8;
    list-style: none;
    padding: 0;
  }
  .sources-list li:before {
    content: "・";
    margin-right: 1mm;
  }

  /* 会社情報 */
  .company-box {
    background: linear-gradient(135deg, rgba(212,175,55,0.1) 0%, rgba(212,175,55,0.05) 100%);
    border: 1px solid rgba(212,175,55,0.4);
    padding: 5mm 6mm;
    border-radius: 2mm;
    margin-top: 6mm;
  }
  .company-name {
    font-size: 14pt;
    font-weight: 900;
    color: #f4d03f;
    margin-bottom: 2mm;
  }
  .company-info {
    font-size: 8.5pt;
    color: #d1d5db;
    line-height: 1.8;
  }
</style>
</head>
<body>

<!-- ======================== 1ページ目 ======================== -->
<div class="page">
  <div class="header">
    <div>
      <div class="logo">HORIZON SHIELD</div>
      <div class="subtitle">建設実務経験30年のプロ監修 AI診断</div>
      <div class="doc-title">交渉用・逆見積書</div>
    </div>
    <div class="meta-right">
      <div>発行日: ${now}</div>
      <div class="order-id">ID: ${escapeHtml(orderInfo.orderId)}</div>
      ${orderInfo.customer_name ? `<div style="margin-top:2mm;color:#e8e8e8;font-size:10pt;">${escapeHtml(orderInfo.customer_name)} 様</div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">診断対象</div>
    <div class="target-grid">
      <div class="target-label">工事内容</div>
      <div class="target-value">${escapeHtml(d.koji_name)}</div>
      <div class="target-label">対象地域</div>
      <div class="target-value">${escapeHtml(regionText)}</div>
      <div class="target-label">業者提示額</div>
      <div class="target-value big">${fmtYen(d.teiji_kingaku)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">診断結果</div>
    <div class="status-box">
      <div class="status-label">${escapeHtml(d.statusLabel)}</div>
      <div class="status-desc">
        ${d.status === 'danger'
          ? `相場の${Math.round(d.ratio * 100)}%に達しており、大幅に超過しています。`
          : d.status === 'warn'
          ? `相場の中央値を${d.gapPct}%上回っています。`
          : d.status === 'ok'
          ? `相場範囲内の適正な価格帯です。`
          : `相場の中央値を${Math.abs(d.gapPct)}%下回っています。内容に含みがないか要確認。`}
      </div>
    </div>

    <table class="price-table">
      <tr><th>相場 最低</th><td class="price-min">${fmtYen(d.adjMin)}</td></tr>
      <tr><th>相場 中央値</th><td class="price-avg">${fmtYen(d.adjAvg)}</td></tr>
      <tr><th>相場 最高</th><td class="price-max">${fmtYen(d.adjMax)}</td></tr>
      <tr><th>警戒ライン</th><td class="price-danger">${fmtYen(d.adjDanger)} 以上</td></tr>
    </table>

    <div class="graph-container">
      <div class="graph-bar">
        <div class="graph-marker" style="left:${minPos}%;"><div class="graph-marker-dot"></div><div class="graph-marker-label">最低</div></div>
        <div class="graph-marker" style="left:${avgPos}%;"><div class="graph-marker-dot"></div><div class="graph-marker-label">中央値</div></div>
        <div class="graph-marker" style="left:${maxPos}%;"><div class="graph-marker-dot"></div><div class="graph-marker-label">最高</div></div>
        <div class="graph-marker" style="left:${dangerPos}%;"><div class="graph-marker-dot"></div><div class="graph-marker-label">警戒</div></div>
        <div class="graph-user" style="left:${userPos}%;">
          <div class="graph-user-arrow">▼</div>
          <div class="graph-user-label">あなた</div>
        </div>
      </div>
      <div class="graph-labels">
        <span>${fmtYen(d.adjMin)}</span>
        <span>${fmtYen(d.adjDanger)}</span>
      </div>
    </div>

    <div class="diff-box ${d.status === 'ok' || d.status === 'cheap' ? 'ok' : d.status === 'warn' ? 'warn' : ''}">
      <div class="diff-label">相場中央値との差分</div>
      <div class="diff-value">${d.gap >= 0 ? '+' : ''}${fmtYen(d.gap)} (${d.gapPct >= 0 ? '+' : ''}${d.gapPct}%)</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">業界統計</div>
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-label">この工事の過剰請求率</div>
        <div class="stats-value red">${overchargeRate}%</div>
      </div>
      <div class="stats-card">
        <div class="stats-label">前月比トレンド</div>
        <div class="stats-value">${escapeHtml(trendText)}</div>
      </div>
    </div>
    ${supplement ? `<div class="supplement">補足: ${escapeHtml(supplement)}</div>` : ''}
  </div>

  <div class="footer">
    <div>HORIZON SHIELD | 建設実務経験30年のプロ監修</div>
    <div>1/2</div>
  </div>
</div>

<!-- ======================== 2ページ目 ======================== -->
<div class="page">
  <div class="header">
    <div>
      <div class="logo">HORIZON SHIELD</div>
      <div class="subtitle">建設実務経験30年のプロ監修 AI診断</div>
      <div class="doc-title">交渉用・逆見積書（続き）</div>
    </div>
    <div class="meta-right">
      <div class="order-id">ID: ${escapeHtml(orderInfo.orderId)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">交渉時に使えるフレーズ</div>
    ${phrases.map((p, i) => `
      <div class="phrase-card">
        <span class="phrase-num">${i + 1}</span>
        <div class="phrase-text">${escapeHtml(p)}</div>
      </div>
    `).join('')}
  </div>

  <div class="disclaimer">
    <div class="disclaimer-title">必須注意書き・免責事項</div>
    <div class="disclaimer-text">
      本書は建設業界の一般的な相場データに基づくAI算出による参考見積もりであり、確定金額ではありません。<br>
      実際の工事費用は、現場の状況（構造・築年数・搬入条件・既存設備の状態・地域の人件費水準等）により大幅に変動する可能性があります。<br>
      本書は業者との価格交渉における「相場感の参考資料」としてご活用ください。最終的な契約判断はお客様ご自身の責任において行ってください。<br>
      本書の内容に基づく交渉結果について、HORIZON SHIELD（The HORIZ音s株式会社）は一切の責任を負いかねます。
    </div>
  </div>

  <div class="sources">
    <div class="sources-title">【データソース】</div>
    <ul class="sources-list">
      <li>ヌリカエ 2025年12月施工データ2,655件</li>
      <li>リショップナビ 2026年2〜3月集計</li>
      <li>テイガク 2026年屋根リフォーム単価表</li>
      <li>リフォームガイド 2026年最新版</li>
      <li>タカラスタンダード リフォーム実例集</li>
      <li>SHUKEN Re 2026年時点実績</li>
      <li>シロアリ駆除業者人気ランキング 2026年4月205社調査</li>
      <li>経済調査会『積算資料ポケット版 リフォーム編 2026』</li>
    </ul>
  </div>

  <div class="company-box">
    <div class="company-name">HORIZON SHIELD</div>
    <div class="company-info">
      運営: The HORIZ音s株式会社<br>
      所在地: 東京都港区南青山2-2-15 ウィン青山942<br>
      Web: https://shield.the-horizons-innovation.com &nbsp;&nbsp; LINE: @172piime
    </div>
  </div>

  <div class="footer">
    <div>HORIZON SHIELD | 建設実務経験30年のプロ監修</div>
    <div>2/2</div>
  </div>
</div>

</body>
</html>`;
}

// ============================================================
// PDF生成（メイン）
// ============================================================

// ============================================================
// 逆見積もりKIRA PLANテキスト → 構造化データ変換
// ============================================================
function parsePlanText(planText) {
  const result = {
    koji_content: '',
    breakdown: [],
    subtotal: '',
    expenses: '',
    matsu: '',
    take: '',
    ume: '',
    advice: '',
    source: '',
  };
  const inner = planText.replace(/===PLAN===/, '').replace(/===END===/, '').trim();
  const lines = inner.split('\n');
  let inBreakdown = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('工事内容：')) {
      result.koji_content = t.replace('工事内容：', '').trim();
    } else if (t === '【工事内訳】') {
      inBreakdown = true;
    } else if (inBreakdown && t.startsWith('・')) {
      result.breakdown.push(t.replace('・', '').trim());
    } else if (t.startsWith('小計：')) {
      inBreakdown = false;
      result.subtotal = t.replace('小計：', '').trim();
    } else if (t.startsWith('諸経費')) {
      result.expenses = t.replace(/^諸経費[（(][^）)]*[）)][:：]?\s*/, '').trim() || t;
    } else if (t.startsWith('松：')) {
      result.matsu = t.replace('松：', '').trim();
    } else if (t.startsWith('竹：')) {
      result.take = t.replace('竹：', '').trim();
    } else if (t.startsWith('梅：')) {
      result.ume = t.replace('梅：', '').trim();
    } else if (t.startsWith('アドバイス：')) {
      result.advice = t.replace('アドバイス：', '').trim();
    } else if (t.startsWith('出典：')) {
      result.source = t.replace('出典：', '').trim();
    }
  }
  return result;
}

// ============================================================
// 逆見積もりKIRA PLAN → HTML テンプレート生成
// ============================================================
function generatePlanHTML(d, orderInfo) {
  const now = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const breakdownRows = d.breakdown.map(b => {
    const parts = b.split('：');
    const label = parts[0] || b;
    const val = parts.slice(1).join('：') || '';
    return `<tr><td class="bd-label">・${label}</td><td class="bd-val">${val}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: IPAGothic, sans-serif; background:#fff; color:#1a1a2e; line-height:1.7; }

  /* === 表紙 === */
  .cover {
    background: linear-gradient(160deg, #0a0e1a 0%, #1a1a2e 40%, #0f3460 100%);
    color:#fff; height:100vh; position:relative; overflow:hidden;
    display:flex; flex-direction:column; justify-content:center; align-items:center;
    padding:60px; page-break-after:always;
  }
  .cover::before {
    content:''; position:absolute; top:-200px; right:-200px;
    width:600px; height:600px; border-radius:50%;
    background:radial-gradient(circle, rgba(201,162,39,0.12) 0%, transparent 70%);
  }
  .cover::after {
    content:''; position:absolute; bottom:-100px; left:-100px;
    width:400px; height:400px; border-radius:50%;
    background:radial-gradient(circle, rgba(15,52,96,0.6) 0%, transparent 70%);
  }
  .cover-stamp {
    position:absolute; top:40px; right:40px; z-index:10;
    width:100px; height:100px; border-radius:50%;
    border:2.5px solid #c9a227;
    background:rgba(201,162,39,0.08);
    display:flex; flex-direction:column; justify-content:center; align-items:center;
    box-shadow: 0 0 20px rgba(201,162,39,0.2);
  }
  .cover-stamp-text { font-size:9px; font-weight:700; color:#c9a227; letter-spacing:2px; }
  .cover-stamp-check { font-size:20px; color:#c9a227; line-height:1; }
  .cover-eyebrow {
    background:rgba(201,162,39,0.15); border:1px solid rgba(201,162,39,0.4);
    border-radius:30px; padding:6px 20px; font-size:10px; letter-spacing:3px;
    color:#c9a227; margin-bottom:32px; z-index:1;
  }
  .cover-title { font-size:42px; font-weight:900; text-align:center; line-height:1.2; margin-bottom:16px; z-index:1; }
  .cover-title em { color:#c9a227; font-style:normal; display:block; }
  .cover-sub { font-size:14px; color:rgba(255,255,255,0.6); text-align:center; margin-bottom:48px; z-index:1; line-height:1.8; }
  .cover-case {
    background:rgba(255,255,255,0.05); border:1px solid rgba(201,162,39,0.5);
    border-radius:16px; padding:24px 40px; text-align:center; margin-bottom:40px; z-index:1;
    max-width:560px; width:100%;
  }
  .cover-case-label { font-size:10px; color:#c9a227; letter-spacing:3px; margin-bottom:10px; }
  .cover-case-val { font-size:17px; font-weight:700; line-height:1.5; }
  .cover-meta { font-size:12px; color:rgba(255,255,255,0.5); z-index:1; }
  .cover-footer { position:absolute; bottom:32px; font-size:10px; color:rgba(255,255,255,0.3); text-align:center; z-index:1; }

  /* === 共通ページ === */
  .page { padding:52px 52px 40px; page-break-after:always; position:relative; }
  .page:last-child { page-break-after:auto; }
  .page-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:36px; padding-bottom:16px; border-bottom:1px solid #eee; }
  .page-logo { font-size:11px; font-weight:700; color:#0f3460; letter-spacing:2px; }
  .page-num { font-size:10px; color:#999; }
  .section-title {
    font-size:11px; color:#c9a227; font-weight:700; letter-spacing:3px;
    margin-bottom:6px; text-transform:uppercase;
  }
  .section-heading { font-size:24px; font-weight:900; color:#1a1a2e; margin-bottom:28px; line-height:1.3; }

  /* === 松竹梅プラン === */
  .plan-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:36px; }
  .plan-card {
    border-radius:16px; padding:28px 20px; text-align:center;
    position:relative; overflow:hidden;
    page-break-inside: avoid; break-inside: avoid;
  }
  .plan-card.matsu { background:#fdf8ec; border:2px solid #c9a227; }
  .plan-card.take { background:#0f3460; border:2px solid #0f3460; color:#fff; }
  .plan-card.ume { background:#f0f7f0; border:2px solid #2d7a4e; }
  .plan-label { font-size:9px; font-weight:700; letter-spacing:3px; margin-bottom:4px; }
  .plan-card.matsu .plan-label { color:#c9a227; }
  .plan-card.take .plan-label { color:rgba(255,255,255,0.7); }
  .plan-card.ume .plan-label { color:#2d7a4e; }
  .plan-type { font-size:11px; margin-bottom:16px; opacity:0.7; }
  .plan-price { font-size:20px; font-weight:900; line-height:1.3; }
  .plan-card.matsu .plan-price { color:#1a1a2e; }
  .plan-card.take .plan-price { color:#fff; }
  .plan-card.ume .plan-price { color:#1a1a2e; }
  .plan-recommend {
    background:#c9a227; color:#fff; font-size:9px; font-weight:700;
    padding:4px 14px; border-radius:20px; margin-top:12px; display:inline-block; letter-spacing:1px;
  }

  /* === 内訳テーブル === */
  .breakdown-table { width:100%; border-collapse:collapse; margin-bottom:28px; }
  .breakdown-table thead tr { background:#1a1a2e; }
  .breakdown-table thead th { color:#fff; font-size:11px; padding:12px 16px; text-align:left; font-weight:700; }
  .breakdown-table thead th:last-child { text-align:right; }
  .breakdown-table tbody tr:nth-child(even) { background:#f9f9f9; }
  .breakdown-table tbody td { padding:10px 16px; font-size:12px; border-bottom:1px solid #f0f0f0; }
  .bd-label { color:#333; }
  .bd-val { text-align:right; color:#0f3460; font-weight:700; }
  .subtotal-row { background:#eef4ff !important; }
  .subtotal-row td { font-weight:900; color:#0f3460; padding:12px 16px; }

  /* === アドバイスボックス === */
  .advice-box {
    background:linear-gradient(135deg, #fffdf0, #fffbf0);
    border-left:4px solid #c9a227; border-radius:0 12px 12px 0;
    padding:20px 24px; margin-bottom:24px;
  }
  .advice-box p { font-size:13px; line-height:1.9; color:#333; }

  /* === プロフィール === */
  .profile-card {
    background:linear-gradient(135deg, #1a1a2e, #0f3460);
    border-radius:20px; padding:40px; color:#fff; margin-bottom:28px;
    display:flex; gap:32px; align-items:flex-start;
    page-break-inside: avoid; break-inside: avoid;
  }
  .profile-avatar {
    width:80px; height:80px; border-radius:50%; flex-shrink:0;
    background:rgba(201,162,39,0.2); border:2px solid #c9a227;
    display:flex; flex-direction:column; justify-content:center; align-items:center;
  }
  .profile-avatar-text { font-size:10px; color:#c9a227; font-weight:700; letter-spacing:1px; text-align:center; line-height:1.4; }
  .profile-name { font-size:22px; font-weight:900; margin-bottom:4px; }
  .profile-title { font-size:12px; color:#c9a227; margin-bottom:12px; }
  .profile-bio { font-size:13px; color:rgba(255,255,255,0.75); line-height:1.8; }
  .profile-message {
    background:rgba(255,255,255,0.06); border-radius:12px;
    padding:20px 24px; margin-top:16px;
    border-left:3px solid #c9a227;
  }
  .profile-message p { font-size:13px; color:rgba(255,255,255,0.85); line-height:1.9; }

  /* === 特記事項 === */
  .notice-box {
    background:#fff8f8; border:1.5px solid #e53e3e; border-radius:12px;
    padding:24px 28px; margin-bottom:20px;
  }
  .notice-title { font-size:13px; font-weight:900; color:#e53e3e; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
  .notice-body { font-size:12px; line-height:1.9; color:#444; }
  .notice-body li { margin-bottom:8px; padding-left:12px; position:relative; }
  .notice-body li::before { content:'▶'; position:absolute; left:0; color:#e53e3e; font-size:9px; top:3px; }

  /* === 業者選定 === */
  .criterion-card {
    background:#f8faff; border-radius:12px; padding:20px 24px;
    margin-bottom:16px; border-left:4px solid #0f3460;
    page-break-inside: avoid; break-inside: avoid;
  }
  .criterion-num { font-size:10px; font-weight:700; color:#0f3460; letter-spacing:2px; margin-bottom:6px; }
  .criterion-title { font-size:15px; font-weight:900; color:#1a1a2e; margin-bottom:8px; }
  .criterion-body { font-size:12px; color:#555; line-height:1.8; }

  /* === 危険サイン === */
  .sign-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .sign-card {
    background:#fff5f5; border:1px solid rgba(229,62,62,0.2);
    border-radius:12px; padding:16px 18px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .sign-num { font-size:9px; font-weight:700; color:#e53e3e; letter-spacing:2px; margin-bottom:4px; }
  .sign-title { font-size:13px; font-weight:900; color:#1a1a2e; margin-bottom:6px; }
  .sign-body { font-size:11px; color:#666; line-height:1.7; }
  .sign-card.full { grid-column:1/-1; }

  /* === CTA === */
  .cta-section {
    background:linear-gradient(135deg, #1a1a2e, #0f3460);
    border-radius:20px; padding:40px; text-align:center; margin-bottom:32px;
  }
  .cta-eyebrow { font-size:10px; color:#c9a227; letter-spacing:3px; margin-bottom:12px; }
  .cta-title { font-size:22px; font-weight:900; color:#fff; margin-bottom:12px; line-height:1.4; }
  .cta-sub { font-size:13px; color:rgba(255,255,255,0.65); margin-bottom:24px; line-height:1.8; }
  .cta-price { font-size:32px; font-weight:900; color:#c9a227; }
  .cta-price-note { font-size:11px; color:rgba(255,255,255,0.5); margin-top:4px; }

  .source-text { font-size:10px; color:#aaa; line-height:1.6; margin-top:16px; }
  .divider { border:none; border-top:1px solid #eee; margin:24px 0; }
</style>
</head>
<body>

<!-- ===== 表紙 ===== -->
<div class="cover">
  <div class="cover-stamp">
    <div class="cover-stamp-text">HORIZON</div>
    <div class="cover-stamp-check">✓</div>
    <div class="cover-stamp-text">SHIELD</div>
    <div style="font-size:8px;color:rgba(201,162,39,0.7);margin-top:2px;">診断済</div>
  </div>
  <div class="cover-eyebrow">HORIZON SHIELD — 逆見積もり診断レポート</div>
  <div class="cover-title">工事前に知る<em>適正予算</em></div>
  <div class="cover-sub">業者に言われるがまま払う前に。<br>建設30年のプロが算出した「本当の相場」を手に入れてください。</div>
  <div class="cover-case">
    <div class="cover-case-label">診断工事内容</div>
    <div class="cover-case-val">${d.koji_content || '工事内容未入力'}</div>
  </div>
  <div class="cover-meta">${orderInfo.customer_name.replace(/様$/, '').trim()} 様 ／ 診断日：${now}</div>
  <div class="cover-footer">HORIZON SHIELD ／ The HORIZ音s株式会社 ／ shield.the-horizons-innovation.com</div>
</div>

<!-- ===== 適正予算3プラン + 内訳 ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">2 / 8</div>
  </div>
  <div class="section-title">COST ESTIMATE</div>
  <div class="section-heading">適正予算 3プラン</div>
  <div class="plan-grid">
    <div class="plan-card matsu">
      <div class="plan-label">MATSU / 松</div>
      <div class="plan-type">大手リフォーム会社</div>
      <div class="plan-price">${d.matsu || '—'}</div>
    </div>
    <div class="plan-card take">
      <div class="plan-label">TAKE / 竹</div>
      <div class="plan-type">地域中小工務店</div>
      <div class="plan-price">${d.take || '—'}</div>
      <div class="plan-recommend">★ 推奨プラン</div>
    </div>
    <div class="plan-card ume">
      <div class="plan-label">UME / 梅</div>
      <div class="plan-type">個人事業者</div>
      <div class="plan-price">${d.ume || '—'}</div>
    </div>
  </div>

  ${breakdownRows ? `
  <div class="section-title" style="margin-top:8px;">BREAKDOWN</div>
  <div class="section-heading" style="font-size:18px;">工事費内訳</div>
  <table class="breakdown-table">
    <thead><tr><th>工事項目</th><th style="text-align:right">金額（竹基準）</th></tr></thead>
    <tbody>
      ${breakdownRows}
      ${d.subtotal ? `<tr class="subtotal-row"><td class="bd-label" style="font-weight:900;">小計</td><td class="bd-val">${d.subtotal}</td></tr>` : ''}
      ${d.expenses ? `<tr class="subtotal-row"><td class="bd-label" style="font-weight:900;">諸経費</td><td class="bd-val">${d.expenses}</td></tr>` : ''}
    </tbody>
  </table>
  ` : ''}

  ${d.advice ? `
  <div class="section-title">KIRA ADVICE</div>
  <div class="advice-box"><p>${d.advice}</p></div>
  ` : ''}
  <div class="source-text">出典：${d.source || 'HORIZON SHIELD souba-db'}</div>
</div>

<!-- ===== 大賀俊勝プロフィール + 意義 ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">3 / 8</div>
  </div>
  <div class="section-title">FROM THE FOUNDER</div>
  <div class="section-heading">このレポートを届ける理由</div>
  <div class="profile-card">
    <div class="profile-avatar">
      <div class="profile-avatar-text">HORIZON<br>SHIELD</div>
    </div>
    <div style="flex:1;">
      <div class="profile-name">大賀 俊勝</div>
      <div class="profile-title">The HORIZ音s株式会社 代表取締役 ／ 建設実務30年・査定500件超</div>
      <div class="profile-bio">大工・現場監督・CMR（コンストラクション・マネジメント）を経て、AI技術と現場経験を融合したHORIZON SHIELDを創業。「施主が損をしない社会をつくる」をミッションに建設費の透明化に取り組む。<br><br>建設費相場データベース「Japan Construction Cost Database (JCCDB)」を構築・公開。学術論文はSSRN（Elsevier）・engrXiv・Zenodoに掲載。ORCID: 0009-0000-9180-903X</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.4);border-radius:6px;padding:4px 10px;font-size:10px;color:#c9a227;">SSRN / Elsevier 掲載</span>
        <span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.4);border-radius:6px;padding:4px 10px;font-size:10px;color:#c9a227;">DOI: 10.31224/7007</span>
        <span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.4);border-radius:6px;padding:4px 10px;font-size:10px;color:#c9a227;">Zenodo: 10.5281/zenodo.20019572</span>
        <span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.4);border-radius:6px;padding:4px 10px;font-size:10px;color:#c9a227;">朝日・東洋経済・TBS等 79媒体掲載</span>
      </div>
      <div class="profile-message">
        <p>「工事費を間違いなく払っているか」を自分で確認できる人は、ほとんどいません。私は30年間、現場で何百件もの見積書を見てきました。善意の業者もいれば、そうでない業者もいる。だからこそ、施主が自分自身で相場を知り、対等に交渉できる武器を持つべきだと確信しています。このレポートが、あなたの大切な工事を守る一助となれば幸いです。</p>
      </div>
    </div>
  </div>
  <div class="section-title" style="margin-top:8px;">HOW TO USE</div>
  <div class="section-heading" style="font-size:18px;">HORIZON SHIELDの使い方</div>
  <div class="criterion-card">
    <div class="criterion-num">STEP 01</div>
    <div class="criterion-title">このレポートの金額を「基準」として持つ</div>
    <div class="criterion-body">松竹梅の適正レンジを頭に入れて、業者との交渉に臨んでください。根拠のある数字があるだけで、交渉の成功率は大幅に上がります。</div>
  </div>
  <div class="criterion-card">
    <div class="criterion-num">STEP 02</div>
    <div class="criterion-title">3社以上から正式見積もりを取る</div>
    <div class="criterion-body">本レポートは「相場感を知る逆見積もり」です。実際の工事契約には、必ず業者から正式な見積書を取得してください。比較することで初めて適正な価格が見えてきます。</div>
  </div>
  <div class="criterion-card">
    <div class="criterion-num">STEP 03</div>
    <div class="criterion-title">見積書が届いたら建設費診断で確認する</div>
    <div class="criterion-body">業者から見積書が届いたら、HORIZON SHIELDの建設費診断（¥55,000）で過剰請求パターンを1項目ずつ検出できます。</div>
  </div>
</div>

<!-- ===== 特記事項 ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">4 / 8</div>
  </div>
  <div class="section-title">IMPORTANT NOTICE</div>
  <div class="section-heading">ご利用前に必ずお読みください</div>
  <div class="notice-box">
    <div class="notice-title">⚠ 逆見積もりレポートについて（重要）</div>
    <ul class="notice-body">
      <li>本レポートは<strong>「逆見積もり」</strong>です。業者から見積もりをもらう前に、相場感を把握していただくための参考資料です。</li>
      <li>本レポートの金額は確定見積もりではありません。<strong>実際の工事契約には、必ず業者から正式な見積書を取得してください。</strong></li>
      <li>記載金額は2026年時点の相場データに基づきます。資材価格・人件費の変動により、実際の工事費用は変動します。</li>
      <li>現場の状況（構造・築年数・搬入条件・既存設備の状態）により、実際の費用が本レポートと大きく異なる場合があります。</li>
      <li>本レポートを業者に見せて交渉することは問題ありませんが、<strong>本レポートの金額での契約を業者に強要することはお控えください。</strong></li>
    </ul>
  </div>
  <div class="notice-box" style="background:#fff8f0; border-color:#e07820;">
    <div class="notice-title" style="color:#e07820;">📋 正式見積もり取得のお願い</div>
    <ul class="notice-body">
      <li>工事契約には<strong>必ず書面による正式見積書</strong>を業者から取得してください。</li>
      <li>見積書には工事内容・数量・単価・材料グレード・工期・保証条件を明記させてください。</li>
      <li>「一式」だけの見積書は後のトラブルの原因になります。必ず項目別の内訳を要求してください。</li>
      <li>最低3社から相見積もりを取ることを強くお勧めします。</li>
    </ul>
  </div>
  <div class="advice-box">
    <p>📌 <strong>HORIZON SHIELDより：</strong>業者から正式見積書が届いたら、ぜひHORIZON SHIELDの建設費診断をご利用ください。見積書の各項目が適正かどうか、過剰請求パターンがないかを1項目ずつ専門家視点で診断します（¥55,000・2営業日以内）。</p>
  </div>
</div>

<!-- ===== 業者選定 + 交渉術 ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">5 / 8</div>
  </div>
  <div class="section-title">VENDOR SELECTION</div>
  <div class="section-heading">業者選定の3原則と交渉術</div>
  <div class="criterion-card">
    <div class="criterion-num">RULE 01</div>
    <div class="criterion-title">建設業許可番号の確認</div>
    <div class="criterion-body">許可番号は国交省検索システムで真偽を必ず確認。URL: https://etsuran2.mlit.go.jp/TAKKEN/ ／ 500万円未満でも許可業者を推奨します。</div>
  </div>
  <div class="criterion-card">
    <div class="criterion-num">RULE 02</div>
    <div class="criterion-title">詳細見積書の提出を義務化する</div>
    <div class="criterion-body">「一式○○万円」は水増しの温床。材料費・工賃・数量・諸経費を項目別に分けた詳細見積書を必ず要求。拒否する業者は契約しないこと。</div>
  </div>
  <div class="criterion-card">
    <div class="criterion-num">RULE 03</div>
    <div class="criterion-title">3社以上の相見積もりを取る</div>
    <div class="criterion-body">1社だけの見積もりは比較基準がなく過剰請求に気づけません。相見積もりを嫌がる業者・即決を迫る業者は誠実ではありません。</div>
  </div>
  <hr class="divider">
  <div class="section-title" style="margin-top:4px;">NEGOTIATION TIPS</div>
  <table class="breakdown-table">
    <thead><tr><th>交渉ポイント</th><th>実践方法</th></tr></thead>
    <tbody>
      <tr><td class="bd-label">相見積もり</td><td>同一条件（工事内容・範囲・材料）で3社以上に依頼。条件を統一しないと比較できない</td></tr>
      <tr><td class="bd-label">着工前の契約書</td><td>工事範囲・完成基準・支払い条件を明文化。口頭約束は無効と心得る</td></tr>
      <tr><td class="bd-label">中間金の支払い</td><td>進捗確認後に支払う。前払い一括は絶対に避けること</td></tr>
      <tr><td class="bd-label">追加工事の承認</td><td>着工後の追加は必ず書面で金額確認してから承認。口頭OKは禁止</td></tr>
      <tr><td class="bd-label">アフター保証</td><td>完成後1〜2年の瑕疵保証を契約に明記。期間・範囲・免責事項を書面で確認</td></tr>
    </tbody>
  </table>
</div>

<!-- ===== 危険サイン9選 ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">6 / 8</div>
  </div>
  <div class="section-title">WARNING SIGNS</div>
  <div class="section-heading">即逃げるべき業者の危険サイン 9選</div>
  <div class="sign-grid">
    <div class="sign-card">
      <div class="sign-num">SIGN 01</div>
      <div class="sign-title">突然の訪問営業</div>
      <div class="sign-body">「近所で工事中に見えて」「今日中に決めれば割引」は悪質業者の常套手段。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 02</div>
      <div class="sign-title">「火災保険で実質0円」</div>
      <div class="sign-body">災害起因でない劣化を災害扱いで申請するのは保険詐欺。加担すれば施主も責任を問われる。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 03</div>
      <div class="sign-title">その場での契約要求</div>
      <div class="sign-body">「今日だけ特別価格」は高圧販売。誠実な業者は必ず比較検討の時間を提供する。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 04</div>
      <div class="sign-title">詳細見積書を出さない</div>
      <div class="sign-body">「一式」のみで内訳を示さない業者は水増しを隠している可能性大。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 05</div>
      <div class="sign-title">許可番号を示さない</div>
      <div class="sign-body">建設業許可番号の提示を求めて答えられない業者は未登録の可能性。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 06</div>
      <div class="sign-title">極端に安い見積もり</div>
      <div class="sign-body">相場の半額以下は手抜き・材料偽装のサイン。完工後に追加請求する手口も横行。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 07</div>
      <div class="sign-title">口頭のみで書面なし</div>
      <div class="sign-body">「後で書類送ります」は危険。着工前に契約書・仕様書・保証書を必ず書面確認。</div>
    </div>
    <div class="sign-card">
      <div class="sign-num">SIGN 08</div>
      <div class="sign-title">下請けの多層構造</div>
      <div class="sign-body">元請→1次→2次→3次と重なるほど中間マージンが発生。直施工または1次下請けまでを確認。</div>
    </div>
    <div class="sign-card full">
      <div class="sign-num">SIGN 09</div>
      <div class="sign-title">アフター保証が曖昧</div>
      <div class="sign-body">「何かあれば連絡を」では不十分。保証書の期間・範囲・免責事項を必ず書面で確認してください。</div>
    </div>
  </div>
</div>

<!-- ===== 交渉テンプレート ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">7 / 8</div>
  </div>
  <div class="section-title">NEGOTIATION TEMPLATE</div>
  <div class="section-heading">そのままコピペで使える交渉テンプレート</div>
  <div class="advice-box" style="margin-bottom:20px;">
    <p><strong>【テンプレート①：見積もり内訳の開示依頼】</strong><br><br>
    お世話になっております。先日ご提出いただきました見積書についてご確認させてください。<br>
    各項目について、材料費・工賃・数量・単価を別々に記載いただけますでしょうか。<br>
    「一式」でまとめられている項目の内訳をご提示いただけますと助かります。<br>
    ご対応のほど、よろしくお願いいたします。</p>
  </div>
  <div class="advice-box" style="margin-bottom:20px;">
    <p><strong>【テンプレート②：値引き交渉】</strong><br><br>
    ご提示いただいた金額について、他社との比較も行っております。<br>
    今回の工事はぜひ御社にお願いしたいと考えておりますが、<br>
    予算の関係で○○万円程度でのご対応は可能でしょうか。<br>
    ご検討のほど、よろしくお願いいたします。</p>
  </div>
  <div class="advice-box">
    <p><strong>【テンプレート③：追加工事の書面確認】</strong><br><br>
    追加工事についてご連絡いただきありがとうございます。<br>
    承認前に、追加工事の内容・金額・工期への影響を書面でご提示ください。<br>
    内容を確認してから正式にご返答させていただきます。<br>
    お手数をおかけしますが、よろしくお願いいたします。</p>
  </div>
  <div class="notice-box" style="margin-top:24px;">
    <div class="notice-title" style="color:#e53e3e; font-size:12px;">⚖ テンプレート③を提示しても応じない業者へ</div>
    <div class="notice-body" style="font-size:11px;">消費生活センター（局番なし188）または建設業担当窓口へ相談してください。消費者契約法・建設業法に基づき、書面なき追加請求には応じる義務はありません。</div>
  </div>
</div>

<!-- ===== CTA + 免責 + 会社情報 + ハッシュ ===== -->
<div class="page">
  <div class="page-header">
    <div class="page-logo">HORIZON SHIELD</div>
    <div class="page-num">8 / 8</div>
  </div>
  <div class="cta-section">
    <div class="cta-eyebrow">NEXT STEP</div>
    <div class="cta-title">見積書が届いたら、<br>即チェックで過剰請求を防ぐ。</div>
    <div class="cta-sub">業者から見積書が届いたら、HORIZON SHIELDの建設費診断で<br>過剰請求パターンを1項目ずつ検出します。2営業日以内にPDFレポートを納品。</div>
    <div class="cta-price">¥55,000<span style="font-size:14px;color:rgba(255,255,255,0.5);">（税込）</span></div>
    <div class="cta-price-note">LINE: @172piime ／ Web: shield.the-horizons-innovation.com</div>
  </div>
  <div style="background:#f8f8f8; border-radius:12px; padding:20px 24px; margin-bottom:20px; font-size:11px; color:#666; line-height:1.9;">
    <div style="font-weight:700; color:#333; margin-bottom:8px;">■ 免責事項</div>
    本レポートは建設業界の一般的な相場データに基づくAI算出による参考資料であり、確定金額ではありません。実際の工事費用は現場の状況により大幅に変動します。本書は価格交渉における相場感の参考資料としてご活用ください。最終的な契約判断はお客様ご自身の責任において行ってください。本書の内容に基づく交渉結果についてHORIZON SHIELD（The HORIZ音s株式会社）は一切の責任を負いかねます。
  </div>
  <div style="background:linear-gradient(135deg, rgba(201,162,39,0.08), rgba(201,162,39,0.03)); border:1px solid rgba(201,162,39,0.3); border-radius:12px; padding:20px 24px; margin-bottom:20px;">
    <div style="font-size:13px; font-weight:900; color:#c9a227; margin-bottom:10px;">HORIZON SHIELD</div>
    <div style="font-size:11px; color:#555; line-height:1.9;">運営：The HORIZ音s株式会社<br>所在地：東京都港区南青山2-2-15 ウィン青山942<br>Web：https://shield.the-horizons-innovation.com　LINE：@172piime</div>
  </div>
  <div style="background:#1a1a2e; border-radius:10px; padding:14px 20px; display:flex; justify-content:space-between; align-items:center;">
    <div style="font-size:10px; color:rgba(255,255,255,0.4); letter-spacing:1px;">監査ハッシュ（再現性証明）</div>
    <div style="font-size:13px; font-weight:700; color:#c9a227; font-family:monospace; letter-spacing:2px;">${d.planHash || '—'}</div>
  </div>
</div>

</body>
</html>`;
}

async function generatePDF(params, env) {
  const orderInfo = {
    orderId: params.orderId || `test-${Date.now()}`,
    customer_name: params.customer_name || '',
  };

  const d = await diagnose(params, env);
  const html = generateHTML(d, orderInfo);

  // Browser Rendering 起動
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // フォント描画安定化待機
    await page.evaluateHandle('document.fonts.ready');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return { pdfBuffer, orderInfo, diagnosis: d };
  } finally {
    await browser.close();
  }
}

// ============================================================
// 通知処理 (v11: 3チャネル並列配信)
// ============================================================

// ----- プリミティブ層: 各チャネルへの単発送信 -----

async function sendLineMessage(userId, message, env) {
  if (!userId || !env.LINE_CHANNEL_TOKEN) return false;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text: message }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('LINE send failed:', res.status, errText);
    }
    return res.ok;
  } catch (e) {
    console.error('LINE send error:', e);
    return false;
  }
}

async function sendResendEmail(to, subject, html, env) {
  if (!to || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        // TODO: kira@the-horizons-innovation.com のドメイン認証完了後に from を戻す
        // (補助金通過後、お名前.com のネームサーバー問題を専門家に依頼して解決予定)
        from: 'HORIZON SHIELD <onboarding@resend.dev>',
        to: [to],
        reply_to: 'contact@the-horizons-innovation.com',
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend send failed:', res.status, errText);
    }
    return res.ok;
  } catch (e) {
    console.error('Resend send error:', e);
    return false;
  }
}

// ntfy.sh 無料プッシュ通知サービス (TOshi監視用専用チャネル)
// Priority: min|low|default|high|urgent
async function sendNtfyNotification(title, message, env, priority = 'default', tags = 'bell,construction') {
  if (!env.NTFY_TOPIC_URL) return false;
  try {
    const res = await fetch(env.NTFY_TOPIC_URL, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': tags,
      },
      body: message,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('ntfy send failed:', res.status, errText);
    }
    return res.ok;
  } catch (e) {
    console.error('ntfy send error:', e);
    return false;
  }
}

// ----- 組成層: 用途別マルチチャネル送信 -----

// [TOshi向け] 売上通知: LINE + Email + ntfy の3チャネル並列 (冗長化)
async function notifyToshi(orderInfo, d, env) {
  const title = `🎉 逆見積書PDF売上 ¥${SERVICE_FEE.toLocaleString()}`;
  const plainMessage = `${title}

注文ID: ${orderInfo.orderId}
顧客: ${orderInfo.customer_name || '不明'}
工事: ${d.koji_name}
提示額: ${fmtYen(d.teiji_kingaku)}
診断: ${d.statusLabel}

PDF配信完了。`;

  const htmlMessage = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family: 'Hiragino Sans','Yu Gothic',sans-serif; max-width:600px; margin:0 auto; padding:20px;">
  <div style="background:linear-gradient(135deg,#d4af37 0%,#b8941f 100%); color:#fff; padding:20px; border-radius:8px 8px 0 0;">
    <h1 style="margin:0; font-size:18px;">${title}</h1>
  </div>
  <div style="background:#fff; border:1px solid #e5e7eb; border-top:none; padding:20px; border-radius:0 0 8px 8px;">
    <table style="width:100%; border-collapse:collapse;">
      <tr><td style="padding:8px 0; color:#666; width:110px;">注文ID</td><td style="padding:8px 0;"><strong>${escapeHtml(orderInfo.orderId)}</strong></td></tr>
      <tr><td style="padding:8px 0; color:#666;">顧客</td><td style="padding:8px 0;"><strong>${escapeHtml(orderInfo.customer_name || '不明')}</strong></td></tr>
      <tr><td style="padding:8px 0; color:#666;">工事</td><td style="padding:8px 0;">${escapeHtml(d.koji_name)}</td></tr>
      <tr><td style="padding:8px 0; color:#666;">提示額</td><td style="padding:8px 0;"><strong>${fmtYen(d.teiji_kingaku)}</strong></td></tr>
      <tr><td style="padding:8px 0; color:#666;">診断</td><td style="padding:8px 0;"><strong style="color:${d.statusColor};">${escapeHtml(d.statusLabel)}</strong></td></tr>
    </table>
    <p style="margin-top:20px; font-size:13px; color:#666;">PDF配信完了</p>
  </div>
</body></html>`;

  const results = await Promise.allSettled([
    sendLineMessage(env.LINE_USER_ID, plainMessage, env),
    sendResendEmail(env.TOSHI_EMAIL || 'contact@the-horizons-innovation.com', title, htmlMessage, env),
    sendNtfyNotification(title, plainMessage, env, 'high', 'moneybag,horizon-shield'),
  ]);

  return {
    line: results[0].status === 'fulfilled' ? results[0].value : false,
    email: results[1].status === 'fulfilled' ? results[1].value : false,
    ntfy: results[2].status === 'fulfilled' ? results[2].value : false,
  };
}

// [顧客向け] PDF納品: LINE + Email の2チャネル並列
async function sendPDFToCustomer(customerInfo, pdfUrl, d, env) {
  const line_user_id = customerInfo.line_user_id;
  const email = customerInfo.email;
  const customer_name = customerInfo.customer_name || 'お客様';
  const subject = '【HORIZON SHIELD】逆見積書PDFが完成しました';

  const lineMessage = `${customer_name} 様

🎉 逆見積書PDFが完成しました！

━━━━━━━━━━━━━━━━
📄 工事: ${d.koji_name}
💰 業者提示額: ${fmtYen(d.teiji_kingaku)}
📊 診断: ${d.statusLabel}
━━━━━━━━━━━━━━━━

▼ PDFをダウンロード
${pdfUrl}

このPDFは、業者との価格交渉で下記のようにお使いください：

① 業者に「公的データに基づく相場診断」として提示
② 提示額と適正価格の差分の説明を求める
③ 根拠が不十分な場合、交渉フレーズ（PDF内記載）で値下げ交渉

建設実務30年のプロが監修した相場データベースに基づく診断結果です。
疑問点があれば、このLINEへ返信してください。

━━━━━━━━━━━━━━━━
HORIZON SHIELD
The HORIZ音s株式会社
shield.the-horizons-innovation.com`;

  const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'Hiragino Sans','Yu Gothic',sans-serif; max-width:600px; margin:0 auto; padding:20px; color:#333;">
  <div style="background:linear-gradient(135deg,#d4af37 0%,#b8941f 100%); color:#fff; padding:24px; border-radius:8px 8px 0 0;">
    <h1 style="margin:0; font-size:22px;">HORIZON SHIELD</h1>
    <p style="margin:6px 0 0; font-size:13px; opacity:0.9;">建設実務経験30年のプロ監修 AI診断</p>
  </div>
  <div style="background:#fff; border:1px solid #e5e7eb; border-top:none; padding:28px; border-radius:0 0 8px 8px;">
    <h2 style="margin-top:0; font-size:18px;">${escapeHtml(customer_name)} 様</h2>
    <p>この度はHORIZON SHIELDをご利用いただき、誠にありがとうございます。</p>
    <p>ご注文の「交渉用・逆見積書PDF」が完成しましたので、下記よりダウンロードください。</p>
    <table style="width:100%; margin:24px 0; border-collapse:collapse; background:#fafafa; border-radius:6px;">
      <tr><td style="padding:10px 14px; color:#666; width:120px;">工事内容</td><td style="padding:10px 14px;"><strong>${escapeHtml(d.koji_name)}</strong></td></tr>
      <tr><td style="padding:10px 14px; color:#666;">業者提示額</td><td style="padding:10px 14px;"><strong>${fmtYen(d.teiji_kingaku)}</strong></td></tr>
      <tr><td style="padding:10px 14px; color:#666;">診断結果</td><td style="padding:10px 14px;"><strong style="color:${d.statusColor};">${escapeHtml(d.statusLabel)}</strong></td></tr>
    </table>
    <div style="text-align:center; margin:32px 0;">
      <a href="${pdfUrl}" style="display:inline-block; padding:14px 36px; background:#d4af37; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold; font-size:16px;">▼ PDFをダウンロード</a>
    </div>
    <div style="background:#fffbeb; padding:18px; border-radius:6px; border-left:4px solid #d4af37;">
      <p style="margin:0 0 10px; font-weight:bold; color:#92400e;">交渉での使い方</p>
      <p style="margin:0; font-size:14px; line-height:1.8;">
        ① 業者に「公的データに基づく相場診断」として提示<br>
        ② 提示額と適正価格の差分の説明を求める<br>
        ③ 根拠が不十分な場合、交渉フレーズ（PDF内記載）で値下げ交渉
      </p>
    </div>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:28px 0;">
    <p style="font-size:13px; color:#666; line-height:1.7;">
      疑問点があれば、LINE <a href="https://line.me/R/ti/p/@172piime" style="color:#d4af37;">@172piime</a> まで気軽にご返信ください。<br>
      Web: <a href="https://shield.the-horizons-innovation.com" style="color:#d4af37;">shield.the-horizons-innovation.com</a>
    </p>
    <p style="font-size:12px; color:#999; margin-top:20px; line-height:1.6;">
      HORIZON SHIELD<br>
      運営: The HORIZ音s株式会社<br>
      所在地: 東京都港区南青山2-2-15 ウィン青山942
    </p>
  </div>
</body></html>`;

  const tasks = [];
  if (line_user_id) {
    tasks.push(sendLineMessage(line_user_id, lineMessage, env).then(ok => ['line', ok]));
  }
  if (email) {
    tasks.push(sendResendEmail(email, subject, emailHtml, env).then(ok => ['email', ok]));
  }

  const out = { line: false, email: false };
  if (tasks.length === 0) return out;

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const [channel, ok] = r.value;
      out[channel] = ok;
    }
  }
  return out;
}

// ============================================================
// ルーティング
// ============================================================

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Paypay-Signature',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // ===== ヘルスチェック =====
      if (pathname === '/health') {
        return json({
          ok: true,
          service: 'hs-pdf-gen',
          version: '11.0.0',
          engine: 'Browser Rendering (Puppeteer + Chrome)',
          channels: {
            line: !!env.LINE_CHANNEL_TOKEN,
            email: !!env.RESEND_API_KEY,
            ntfy: !!env.NTFY_TOPIC_URL,
          },
        });
      }

      // ===== フォント診断テスト（実環境で動くフォントを探す） =====
      if (pathname === '/font-test' && request.method === 'GET') {
        const testHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { background: white; color: black; font-size: 16pt; padding: 20px; }
  .test { border-bottom: 1px solid #ccc; padding: 8px 0; }
  .label { color: blue; font-size: 12pt; }
</style>
</head>
<body>
<h1>フォント実証テスト FONT TEST</h1>
<div class="test">
  <span class="label">[1] 指定なし (default):</span>
  <div>あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[2] sans-serif:</span>
  <div style="font-family: sans-serif">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[3] serif:</span>
  <div style="font-family: serif">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[4] "Noto Sans CJK JP":</span>
  <div style="font-family: 'Noto Sans CJK JP'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[5] "Noto Sans CJK JP", sans-serif:</span>
  <div style="font-family: 'Noto Sans CJK JP', sans-serif">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[6] IPAGothic:</span>
  <div style="font-family: IPAGothic">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[7] "IPA Gothic":</span>
  <div style="font-family: 'IPA Gothic'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[8] "Takao Gothic":</span>
  <div style="font-family: 'Takao Gothic'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[9] "Noto Sans":</span>
  <div style="font-family: 'Noto Sans'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[10] "WenQuanYi Zen Hei":</span>
  <div style="font-family: 'WenQuanYi Zen Hei'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[11] "DejaVu Sans":</span>
  <div style="font-family: 'DejaVu Sans'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
<div class="test">
  <span class="label">[12] "Liberation Sans":</span>
  <div style="font-family: 'Liberation Sans'">あいうえお日本語テスト漢字カタカナ ABC123</div>
</div>
</body>
</html>`;

        const browser = await puppeteer.launch(env.MYBROWSER);
        try {
          const page = await browser.newPage();
          await page.setContent(testHtml, { waitUntil: 'load' });
          await page.evaluateHandle('document.fonts.ready');
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
          });
          return new Response(pdfBuffer, {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': 'inline; filename="font-test.pdf"',
              ...corsHeaders(),
            },
          });
        } finally {
          await browser.close();
        }
      }

      // ==== /generate (本番フロー) ====
      if (pathname === '/generate' && request.method === 'POST') {
        const params = await request.json();
        const { pdfBuffer, orderInfo } = await generatePDF(params, env);
        return new Response(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="hs-${orderInfo.orderId}.pdf"`,
            ...corsHeaders(),
          },
        });
      }

      // ===== PDF生成テスト（開発用）=====
      // ==== /generate (本番フロー) ====
      if (pathname === '/generate' && request.method === 'POST') {
        const params = await request.json();
        const { pdfBuffer, orderInfo } = await generatePDF(params, env);
        return new Response(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="hs-${orderInfo.orderId}.pdf"`,
            ...corsHeaders(),
          },
        });
      }

      if (pathname === '/generate-test' && request.method === 'POST') {
        const params = await request.json();
        const { pdfBuffer, orderInfo } = await generatePDF(params, env);
        return new Response(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="hs-${orderInfo.orderId}.pdf"`,
            ...corsHeaders(),
          },
        });
      }

      // ===== 逆見積もりKIRA PLAN → PDF生成 =====
      if (pathname === '/generate-plan' && request.method === 'POST') {
        const params = await request.json();
        // params: { plan_text: "===PLAN===...", customer_name: "xxx" }
        const orderInfo = {
          orderId: params.orderId || `plan-${Date.now()}`,
          customer_name: params.customer_name || 'お客様',
        };
        const planData = parsePlanText(params.plan_text || '');
        const rawHash = btoa(encodeURIComponent((params.plan_text || '').slice(-80) + orderInfo.orderId + Date.now())).replace(/[^a-zA-Z0-9]/g,'').slice(0, 16).toUpperCase();
        planData.planHash = rawHash;
        const html = generatePlanHTML(planData, orderInfo);
        const browser = await puppeteer.launch(env.MYBROWSER);
        try {
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'load' });
          await page.evaluateHandle('document.fonts.ready');
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          });
          return new Response(pdfBuffer, {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="hs-plan-${orderInfo.orderId}.pdf"`,
              ...corsHeaders(),
            },
          });
        } finally {
          await browser.close();
        }
      }

      // ===== 統合テスト：PDF生成→R2保存→3チャネル通知まで全部（本番フローの予行演習）=====
      if (pathname === '/generate-and-send' && request.method === 'POST') {
        const params = await request.json();
        const { pdfBuffer, orderInfo, diagnosis } = await generatePDF(params, env);

        // R2 保存
        await env.PDFS_BUCKET.put(`pdfs/${orderInfo.orderId}.pdf`, pdfBuffer, {
          httpMetadata: { contentType: 'application/pdf' },
        });

        const pdfUrl = `${url.origin}/pdf/${orderInfo.orderId}`;

        // [顧客向け] 送信先決定
        // - params.line_user_id / params.email があればそれに送信
        // - どちらも無い場合、テスト用フォールバックとして TOshi の LINE に送る
        const customerInfo = {
          customer_name: params.customer_name || 'テスト太郎',
          line_user_id: params.line_user_id || null,
          email: params.email || null,
        };
        const hasCustomerTarget = customerInfo.line_user_id || customerInfo.email;
        if (!hasCustomerTarget) {
          // テスト用フォールバック: TOshi の LINE にも「顧客宛モック」を届ける
          customerInfo.line_user_id = env.LINE_USER_ID;
        }
        const customerResult = await sendPDFToCustomer(customerInfo, pdfUrl, diagnosis, env);

        // [TOshi向け] 3チャネル並列通知
        const toshiResult = await notifyToshi(orderInfo, diagnosis, env);

        return json({
          ok: true,
          orderId: orderInfo.orderId,
          pdfUrl,
          customer: {
            line: customerResult.line,
            email: customerResult.email,
            target_used: hasCustomerTarget ? 'provided' : 'fallback_to_toshi_line',
          },
          toshi: {
            line: toshiResult.line,
            email: toshiResult.email,
            ntfy: toshiResult.ntfy,
          },
        });
      }

      // ===== PayPay 決済完了 Webhook =====
      // ===== /webhook/paypal - PayPal IPN =====
      if (pathname === '/webhook/paypal' && request.method === 'POST') {
        try {
          const body = await request.text();

          // PayPal IPNサーバーで検証
          const verifyRes = await fetch('https://ipnpb.paypal.com/cgi-bin/webscr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'cmd=_notify-validate&' + body
          });
          const verifyText = await verifyRes.text();

          if (verifyText !== 'VERIFIED') {
            console.log('PayPal IPN not verified:', verifyText);
            return Response.json({ error: 'IPN not verified' }, { status: 400 });
          }

          const params = new URLSearchParams(body);
          const paymentStatus = params.get('payment_status');

          // Completed以外はスキップ
          if (paymentStatus !== 'Completed') {
            return Response.json({ ok: true, skipped: paymentStatus });
          }

          // customフィールドから顧客情報取得
          const customRaw = params.get('custom') || '{}';
          let customData = {};
          try { customData = JSON.parse(decodeURIComponent(customRaw)); } catch(e) {
            try { customData = JSON.parse(customRaw); } catch(e2) {}
          }

          const txnId     = params.get('txn_id') || 'unknown';
          const orderId   = customData.orderId || `paypal-${txnId}`;
          const customerName  = customData.customer_name  || params.get('first_name') || '施主様';
          const customerEmail = customData.customer_email || params.get('payer_email') || '';
          const amount    = params.get('mc_gross') || customData.amount || '';
          // ===== FAIL-CLOSED GATE (2026-07-09) =====
          // ヒアリングデータ(工事種別・提示額)の無い決済から診断を生成しない。
          // 旧実装はここで gaiheki_30tsubo / 1,500,000 / kanto を既定値として補完し、
          // 実在しない「外壁塗装」診断を自動送信していた(2026-07-06 誤診断事故の根本原因)。
          // 検証できないものは発行しない — verify-claim と同じ fail-closed 原則。
          const hsHasHearing = typeof customData.koji_type === 'string' && customData.koji_type.length > 0 && Number(customData.teiji_kingaku) > 0;
          if (!hsHasHearing) {
            const hsHeldExisting = await env.ORDERS.get(`order:${orderId}`);
            if (!hsHeldExisting) {
              await env.ORDERS.put(`order:${orderId}`, JSON.stringify({
                orderId, txnId, customerName, customerEmail, amount,
                status: 'needs_hearing',
                holdReason: 'custom_data_missing_or_invalid',
                customRaw: String(customRaw).slice(0, 500),
                paidAt: new Date().toISOString(),
                paymentMethod: 'paypal'
              }));
            }
            const hsAlert = [
              '🚨 要対応：決済あり・ヒアリング欠落（fail-closed発動・自動PDF停止）',
              `顧客：${customerName}`,
              `メール：${customerEmail || '(IPNに無し)'}`,
              `金額：¥${Number(amount || 0).toLocaleString()}`,
              `注文ID：${orderId}`,
              `txn_id：${txnId}`,
              '→ ヒアリング取得後、手動で正しい診断を発行してください。自動生成は行っていません。'
            ].join('\n');
            try { await sendLineMessage(env.LINE_USER_ID, hsAlert, env); } catch (e3) {}
            try { await sendNtfyNotification('🚨 決済あり・ヒアリング欠落', hsAlert, env, 'urgent', 'warning,paypal'); } catch (e4) {}
            if (customerEmail) {
              const hsMailHtml = `<div style="font-family:sans-serif;line-height:1.8;color:#14202b"><p>お客様</p><p>このたびはHORIZON SHIELDにご決済いただき、誠にありがとうございます（ご注文ID: ${orderId}）。</p><p>正確な診断をお届けするため、ご相談の<b>工事内容の確認</b>をお願いしております。お手数ですが、本メールへの返信で以下をお知らせください。</p><ol><li>工事の種類（例：キッチン交換、内装リフォーム、外壁塗装 など）</li><li>業者から提示された見積金額</li><li>お住まいの都道府県</li><li>見積書をお持ちの場合は添付（写真・PDF可）</li></ol><p>ご返信の確認後、担当（建設実務30年・大賀）が診断レポートを作成してお届けします。内容が確認できないままの自動診断は、正確性を守るため行っておりません。</p><p>The HORIZ音s株式会社 / HORIZON SHIELD<br>https://shield.the-horizons-innovation.com<br>TEL: 0463-74-5917</p></div>`;
              try { await sendResendEmail(customerEmail, '【HORIZON SHIELD】ご決済の確認と工事内容のお伺い', hsMailHtml, env); } catch (e5) {}
            }
            return Response.json({ ok: true, held: 'needs_hearing', orderId });
          }
          const kojiType  = customData.koji_type;
          const teijiKingaku = Number(customData.teiji_kingaku);
          const region    = customData.region || 'all';
          const serviceType = customData.service_type || '逆見積もり診断';

          // 注文をKVに保存
          await env.ORDERS.put(`order:${orderId}`, JSON.stringify({
            orderId, txnId, kojiType, teijiKingaku, region,
            customerName, customerEmail, amount, serviceType,
            status: 'paid',
            paidAt: new Date().toISOString(),
            paymentMethod: 'paypal'
          }));

          // PDF生成リクエスト
          let pdfUrl = '';
          try {
            const pdfReq = new Request('https://hs-pdf-gen.oga-surf-project.workers.dev/generate-and-send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                koji_type: kojiType,
                teiji_kingaku: Number(teijiKingaku),
                region,
                customer_name: customerName,
                customer_email: customerEmail,
                order_id: orderId,
                service_type: serviceType
              })
            });
            const pdfRes = await fetch(pdfReq);
            const pdfData = await pdfRes.json();
            pdfUrl = pdfData.pdf_url || '';
          } catch(pdfErr) {
            console.error('PDF生成エラー:', pdfErr);
          }

          // LINE通知（TOshi宛）
          try {
            const lineMsg = [
              '💰 PayPal決済完了！',
              `顧客：${customerName}`,
              `メール：${customerEmail}`,
              `サービス：${serviceType}`,
              `金額：¥${Number(amount).toLocaleString()}`,
              `工事種別：${kojiType}`,
              `提示金額：¥${Number(teijiKingaku).toLocaleString()}`,
              `地域：${region}`,
              `注文ID：${orderId}`,
              `txn_id：${txnId}`,
              pdfUrl ? `PDF：${pdfUrl}` : 'PDF生成中...',
            ].join('\n');

            await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`
              },
              body: JSON.stringify({
                to: env.LINE_USER_ID || 'Uc7165565cb48b408eb3af5dc07a72a28',
                messages: [{ type: 'text', text: lineMsg }]
              })
            });
          } catch(lineErr) {
            console.error('LINE通知エラー:', lineErr);
          }

          return Response.json({
            ok: true,
            orderId,
            customerName,
            paymentStatus: 'Completed',
            pdfUrl
          });

        } catch(e) {
          console.error('PayPal IPN エラー:', e);
          return Response.json({ error: 'Internal error', detail: e.message }, { status: 500 });
        }
      }

      if (pathname === '/webhook/paypay' && request.method === 'POST') {
        const body = await request.json();
        const orderId = body.data?.merchant_payment_id || body.merchantPaymentId;
        if (!orderId) return json({ error: 'No orderId' }, 400);

        const orderRaw = await env.ORDERS.get(`order:${orderId}`);
        if (!orderRaw) return json({ error: 'Order not found' }, 404);

        const order = JSON.parse(orderRaw);

        const { pdfBuffer, orderInfo, diagnosis } = await generatePDF({
          ...order,
          orderId,
        }, env);

        // R2 保存
        await env.PDFS_BUCKET.put(`pdfs/${orderId}.pdf`, pdfBuffer, {
          httpMetadata: { contentType: 'application/pdf' },
        });

        const pdfUrl = `${url.origin}/pdf/${orderId}`;

        // [顧客向け] LINE + Email 並列送信
        const customerInfo = {
          customer_name: order.customer_name,
          line_user_id: order.line_user_id || null,
          email: order.email || null,
        };
        ctx.waitUntil(sendPDFToCustomer(customerInfo, pdfUrl, diagnosis, env));

        // [TOshi向け] 3チャネル並列通知
        ctx.waitUntil(notifyToshi(orderInfo, diagnosis, env));

        return json({ ok: true, orderId });
      }

      // ===== PDF ダウンロード =====
      if (pathname.startsWith('/pdf/') && request.method === 'GET') {
        const orderId = pathname.replace('/pdf/', '');
        const obj = await env.PDFS_BUCKET.get(`pdfs/${orderId}.pdf`);
        if (!obj) return new Response('PDF not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="HORIZON_SHIELD_${orderId}.pdf"`,
            'Cache-Control': 'public, max-age=604800',
          },
        });
      }

      return json({ error: 'Not Found', path: pathname }, 404);

    } catch (err) {
      console.error('Error:', err);
      return json({
        error: err.message || 'Internal Server Error',
        stack: env.ENVIRONMENT === 'production' ? undefined : err.stack,
      }, 500);
    }
  },
};
