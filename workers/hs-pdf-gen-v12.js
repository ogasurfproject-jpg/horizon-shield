/**
 * hs-pdf-gen v12 - HORIZON SHIELD 参考見積書PDF生成Worker
 *
 * ===== 概要 =====
 * Phase 2 逆見積もりシステム用のPDF生成Worker。
 * 従来のv11.1（単項目）からN項目対応にアップグレード。
 *
 * 【v11.1 → v12 の変更点】
 * ✅ N項目対応（複数工事を1つのPDFに統合）
 * ✅ 3プラン（松/竹★/梅）並列表示対応
 * ✅ 市場警告セクション追加（TOTO/LIXIL受注停止・塗料値上げ等）
 * ✅ Red Flag 警告セクション追加（HSデータベース参照）
 * ✅ 補助金情報セクション追加
 * ✅ 業者交渉テンプレート文面付き
 * ✅ 建設業法完全対応免責（LEGAL_TEMPLATES.md準拠）
 *
 * ===== エンドポイント =====
 * POST /generate
 * Body: {
 *   order_id: "a3b8c9d2-...",
 *   user: { name, email },
 *   extracted_items: [{ koji_type, area, grade_hint, raw_text }, ...],
 *   plans: { matsu, take, ume },
 *   market_alerts: [...],
 *   soubaIndexMetadata: {...}  // HS_SOUBA_INDEX.jsonから該当部分
 * }
 * Response: {
 *   ok: true,
 *   pdf_url: "https://hs-pdfs.r2.dev/{order_id}.pdf",
 *   pdf_base64: "...",  // オプション（R2なしのフォールバック）
 *   expires_at: "..."
 * }
 *
 * ===== 依存 =====
 * - pdf-lib (npm) - ブラウザ/Worker両対応
 * - @pdf-lib/fontkit - カスタムフォント（日本語）
 * - R2: hs-pdfs bucket, hs-fonts bucket
 */


// ==========================================
// 定数: PDF仕様
// ==========================================
const PAGE = {
  A4_W: 595,
  A4_H: 842,
  MARGIN: 48,
};

const COLORS = {
  bg: [0.01, 0.03, 0.06],
  cyan: [0.00, 0.83, 1.00],
  gold: [0.94, 0.75, 0.19],
  white: [0.95, 0.97, 0.98],
  gray: [0.35, 0.48, 0.55],
  lgray: [0.56, 0.67, 0.73],
  red: [1.00, 0.19, 0.25],
  green: [0.00, 1.00, 0.53],
  orange: [1.00, 0.55, 0.00],
};

const FONT_URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf';


// ==========================================
// ハンドラ
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    try {
      if (url.pathname === '/generate' && request.method === 'POST') {
        return handleGenerate(request, env);
      }

      if (url.pathname === '/health') {
        return jsonResponse({ ok: true, version: 'v12.0.0-N-items' });
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};


// ==========================================
// generate ハンドラ
// ==========================================
async function handleGenerate(request, env) {
  const body = await request.json();
  const {
    order_id,
    user = {},
    extracted_items = [],
    plans,
    market_alerts = [],
    red_flags_by_category = {},
    subsidies_available = []
  } = body;

  if (!order_id || !extracted_items.length || !plans) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  // PDF生成
  const pdfBytes = await buildPDF({
    order_id,
    user,
    extracted_items,
    plans,
    market_alerts,
    red_flags_by_category,
    subsidies_available,
  });

  // R2にアップロード
  let pdf_url = null;
  if (env.HS_PDFS) {
    const r2key = `${order_id}.pdf`;
    await env.HS_PDFS.put(r2key, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' }
    });
    pdf_url = `https://hs-pdfs.the-horizons-innovation.com/${r2key}`;
  }

  // KVにメタデータ保存（取引記録）
  if (env.ORDERS) {
    await env.ORDERS.put(`order:${order_id}`, JSON.stringify({
      order_id,
      user,
      plan_summary: {
        matsu: plans.matsu?.total,
        take: plans.take?.total,
        ume: plans.ume?.total,
      },
      items_count: extracted_items.length,
      created_at: new Date().toISOString(),
    }), { expirationTtl: 60 * 60 * 24 * 90 });  // 90日保持
  }

  // base64も返す（R2未設定フォールバック）
  const pdf_base64 = bufferToBase64(pdfBytes);

  return jsonResponse({
    ok: true,
    order_id,
    pdf_url,
    pdf_base64: pdf_url ? null : pdf_base64,  // R2ありならbase64省略
    size_bytes: pdfBytes.length,
    expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
  });
}


// ==========================================
// PDF構築の中核
// ==========================================
async function buildPDF(data) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 日本語フォント読み込み
  const fontBytes = await fetch(FONT_URL).then(r => r.arrayBuffer());
  const jpFont = await pdfDoc.embedFont(fontBytes);

  // ドキュメント情報
  pdfDoc.setTitle(`HORIZON SHIELD 参考見積書 ${data.order_id}`);
  pdfDoc.setAuthor('The HORIZ音s株式会社');
  pdfDoc.setSubject('参考見積書（相場分析レポート）');
  pdfDoc.setKeywords(['参考見積', 'HORIZON SHIELD', '相場分析']);
  pdfDoc.setCreator('HORIZON SHIELD hs-pdf-gen v12');
  pdfDoc.setCreationDate(new Date());

  // ====== Page 1: 表紙 ======
  await drawCoverPage(pdfDoc, jpFont, rgb, data);

  // ====== Page 2: 3プラン並列（メインコンテンツ） ======
  await drawPlansPage(pdfDoc, jpFont, rgb, data);

  // ====== Page 3: 工事項目詳細 ======
  await drawItemDetailsPage(pdfDoc, jpFont, rgb, data);

  // ====== Page 4: 市場警告 & Red Flag ======
  if (data.market_alerts.length > 0 || Object.keys(data.red_flags_by_category).length > 0) {
    await drawWarningsPage(pdfDoc, jpFont, rgb, data);
  }

  // ====== Page 5: 補助金情報 ======
  if (data.subsidies_available.length > 0) {
    await drawSubsidiesPage(pdfDoc, jpFont, rgb, data);
  }

  // ====== Page 6: 業者交渉テンプレート ======
  await drawNegotiationTemplatePage(pdfDoc, jpFont, rgb, data);

  // ====== Page 7: 法的免責事項（重要） ======
  await drawLegalDisclaimerPage(pdfDoc, jpFont, rgb, data);

  return await pdfDoc.save();
}


// ==========================================
// Page 1: 表紙
// ==========================================
async function drawCoverPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  // ヘッダーバー
  page.drawRectangle({
    x: 0, y: PAGE.A4_H - 80, width: PAGE.A4_W, height: 80,
    color: rgb(...COLORS.bg),
  });

  page.drawText('HORIZ音S / SHIELD', {
    x: PAGE.MARGIN, y: PAGE.A4_H - 45,
    size: 10, font, color: rgb(...COLORS.gold),
  });

  page.drawText('REFERENCE ESTIMATE REPORT v12', {
    x: PAGE.MARGIN, y: PAGE.A4_H - 60,
    size: 8, font, color: rgb(...COLORS.cyan),
  });

  // タイトル
  const y = PAGE.A4_H / 2 + 80;
  page.drawText('参 考 見 積 書', {
    x: PAGE.MARGIN, y,
    size: 32, font, color: rgb(0, 0, 0),
  });

  page.drawText('（相場分析レポート）', {
    x: PAGE.MARGIN, y: y - 36,
    size: 14, font, color: rgb(...COLORS.gray),
  });

  // 警告バー
  page.drawRectangle({
    x: PAGE.MARGIN, y: y - 80, width: PAGE.A4_W - PAGE.MARGIN * 2, height: 30,
    color: rgb(1, 0.95, 0.90),
    borderColor: rgb(...COLORS.red),
    borderWidth: 1,
  });
  page.drawText('※ 本書は建設業法上の正式見積もりではありません', {
    x: PAGE.MARGIN + 10, y: y - 72,
    size: 10, font, color: rgb(...COLORS.red),
  });

  // 基本情報
  const infoY = y - 130;
  drawLabelValue(page, font, rgb, PAGE.MARGIN, infoY, '注 文 番 号', data.order_id, 10);
  drawLabelValue(page, font, rgb, PAGE.MARGIN, infoY - 22, '発 行 日', formatDate(new Date()), 10);
  drawLabelValue(page, font, rgb, PAGE.MARGIN, infoY - 44, 'お 客 様', data.user.name || '—', 10);

  // サマリ
  const sumY = infoY - 100;
  page.drawText('▼ 3プラン・合計金額サマリ', {
    x: PAGE.MARGIN, y: sumY, size: 11, font, color: rgb(...COLORS.cyan),
  });

  drawPlanSummaryBox(page, font, rgb, PAGE.MARGIN, sumY - 30, '松 理想プラン（大手リフォーム相場）', data.plans.matsu, COLORS.gray);
  drawPlanSummaryBox(page, font, rgb, PAGE.MARGIN, sumY - 80, '★ 竹 推奨プラン（中小工務店相場） ★', data.plans.take, COLORS.gold);
  drawPlanSummaryBox(page, font, rgb, PAGE.MARGIN, sumY - 130, '梅 最安プラン（個人+ネット調達）', data.plans.ume, COLORS.gray);

  // フッター
  drawCoverFooter(page, font, rgb);
}


function drawPlanSummaryBox(page, font, rgb, x, y, title, plan, color) {
  const W = PAGE.A4_W - PAGE.MARGIN * 2;
  page.drawRectangle({
    x, y: y - 40, width: W, height: 40,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: rgb(...color),
    borderWidth: 0.8,
  });

  page.drawText(title, {
    x: x + 10, y: y - 16, size: 10, font, color: rgb(...color),
  });

  const price = plan?.total ? `¥${plan.total.toLocaleString()}` : '—';
  const priceManEn = plan?.total_man_en ? `（${plan.total_man_en}万円）` : '';
  page.drawText(price + ' ' + priceManEn, {
    x: x + 10, y: y - 32, size: 13, font, color: rgb(0, 0, 0),
  });
}


function drawCoverFooter(page, font, rgb) {
  page.drawLine({
    start: { x: PAGE.MARGIN, y: 80 },
    end: { x: PAGE.A4_W - PAGE.MARGIN, y: 80 },
    thickness: 0.5,
    color: rgb(...COLORS.gray),
  });

  const fooY = 65;
  page.drawText('The HORIZ音s株式会社 / HORIZON SHIELD', {
    x: PAGE.MARGIN, y: fooY, size: 9, font, color: rgb(0, 0, 0),
  });
  page.drawText('神奈川県平塚市東真土1-1-47 GH湘南2（建設部）', {
    x: PAGE.MARGIN, y: fooY - 12, size: 8, font, color: rgb(...COLORS.gray),
  });
  page.drawText('LINE @172piime / kira@the-horizons-innovation.com', {
    x: PAGE.MARGIN, y: fooY - 24, size: 8, font, color: rgb(...COLORS.gray),
  });
  page.drawText('本書は建設業法上の正式見積もりではありません。HSは施工を行いません。', {
    x: PAGE.MARGIN, y: fooY - 36, size: 7.5, font, color: rgb(...COLORS.red),
  });
}


// ==========================================
// Page 2: 3プラン並列
// ==========================================
async function drawPlansPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '3プラン並列提示 / Three Plans Comparison', 2);

  const y = PAGE.A4_H - 110;
  const cardW = (PAGE.A4_W - PAGE.MARGIN * 2 - 20) / 3;

  drawPlanCard(page, font, rgb, PAGE.MARGIN, y, cardW, '松', '理想', data.plans.matsu, COLORS.lgray, false);
  drawPlanCard(page, font, rgb, PAGE.MARGIN + cardW + 10, y, cardW, '★ 竹 ★', '推奨', data.plans.take, COLORS.gold, true);
  drawPlanCard(page, font, rgb, PAGE.MARGIN + (cardW + 10) * 2, y, cardW, '梅', '最安', data.plans.ume, COLORS.lgray, false);

  // HS哲学の説明
  const explY = y - 360;
  page.drawText('▼ 3プランの考え方（HS哲学）', {
    x: PAGE.MARGIN, y: explY, size: 11, font, color: rgb(...COLORS.cyan),
  });

  const philosophy = [
    '松：大手リフォーム会社相場（区分4・粗利35-45%）。ブランド安心・最上級グレード・長期保証。',
    '★竹：中小工務店相場（区分2・粗利25-35%）。地域密着・適正価格・アフター良好。★HS第一推奨★',
    '梅：個人事業+ネット調達活用相場（区分1・粗利20-30%）。必要最小限・予算重視。',
    '',
    'HSは業者を敵視しません。業者規模別の妥当な利益率レンジを透明化し、',
    '「この業者の価格は規模に対して妥当か」を施主が判断できるよう武装化します。',
  ];

  philosophy.forEach((line, i) => {
    page.drawText(line, {
      x: PAGE.MARGIN, y: explY - 16 - (i * 14),
      size: 9, font, color: rgb(...COLORS.gray),
    });
  });

  drawPageFooter(page, font, rgb, data.order_id, 2);
}


function drawPlanCard(page, font, rgb, x, y, w, title, subtitle, plan, color, highlight) {
  const h = 340;

  // 背景
  page.drawRectangle({
    x, y: y - h, width: w, height: h,
    color: highlight ? rgb(1, 0.98, 0.92) : rgb(0.99, 0.99, 0.99),
    borderColor: rgb(...color),
    borderWidth: highlight ? 2 : 0.8,
  });

  // タイトル
  page.drawText(title, {
    x: x + 10, y: y - 20, size: 14, font, color: rgb(...color),
  });
  page.drawText(subtitle + 'プラン', {
    x: x + 10, y: y - 36, size: 9, font, color: rgb(...COLORS.gray),
  });

  // 価格
  const price = plan?.total ? `¥${plan.total.toLocaleString()}` : '—';
  page.drawText(price, {
    x: x + 10, y: y - 64, size: 14, font, color: rgb(0, 0, 0),
  });

  const manEn = plan?.total_man_en ? `${plan.total_man_en}万円` : '';
  page.drawText(manEn, {
    x: x + 10, y: y - 80, size: 10, font, color: rgb(...COLORS.gold),
  });

  // ターゲット業者
  page.drawText((plan?.target_business || '').substring(0, 18), {
    x: x + 10, y: y - 100, size: 7.5, font, color: rgb(...COLORS.gray),
  });

  // 項目リスト（最大5件）
  let itemY = y - 125;
  page.drawText('▼ 内訳（抜粋）', {
    x: x + 10, y: itemY, size: 8, font, color: rgb(...COLORS.cyan),
  });

  const items = (plan?.items || []).slice(0, 6);
  items.forEach((item, i) => {
    const label = (item.message || item.name || item.koji_type || '').substring(0, 22);
    const price = item.total_man_en ? `${item.total_man_en}万` : '';

    page.drawText(`・${label}`, {
      x: x + 10, y: itemY - 16 - (i * 14), size: 7, font, color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(price, {
      x: x + w - 45, y: itemY - 16 - (i * 14), size: 7, font, color: rgb(0.2, 0.2, 0.2),
    });
  });

  // Pros/Cons
  const pcY = y - 240;
  page.drawText('+ ' + (plan?.pros?.[0] || ''), {
    x: x + 10, y: pcY, size: 7, font, color: rgb(...COLORS.green),
  });
  page.drawText('+ ' + (plan?.pros?.[1] || ''), {
    x: x + 10, y: pcY - 12, size: 7, font, color: rgb(...COLORS.green),
  });
  page.drawText('- ' + (plan?.cons?.[0] || ''), {
    x: x + 10, y: pcY - 26, size: 7, font, color: rgb(...COLORS.orange),
  });
}


// ==========================================
// Page 3: 工事項目詳細
// ==========================================
async function drawItemDetailsPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '工事項目 詳細内訳 / Item Breakdown', 3);

  let y = PAGE.A4_H - 110;

  data.extracted_items.forEach((item, idx) => {
    if (y < 120) {
      page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);
      drawPageHeader(page, font, rgb, '工事項目 詳細内訳（続き）', 3);
      y = PAGE.A4_H - 110;
    }

    // 項目ヘッダー
    page.drawRectangle({
      x: PAGE.MARGIN, y: y - 24, width: PAGE.A4_W - PAGE.MARGIN * 2, height: 24,
      color: rgb(0.95, 0.98, 1.00),
      borderColor: rgb(...COLORS.cyan),
      borderWidth: 0.5,
    });

    page.drawText(`項目 ${idx + 1}: [${item.koji_type}] ${item.area ? `${item.area}㎡` : ''}`, {
      x: PAGE.MARGIN + 10, y: y - 16,
      size: 10, font, color: rgb(...COLORS.cyan),
    });

    page.drawText(`grade: ${item.grade_hint}`, {
      x: PAGE.A4_W - PAGE.MARGIN - 100, y: y - 16,
      size: 9, font, color: rgb(...COLORS.gray),
    });

    y -= 34;

    // お客様のご要望
    page.drawText('お客様のご要望:', {
      x: PAGE.MARGIN, y, size: 9, font, color: rgb(...COLORS.gray),
    });
    page.drawText(`「${(item.raw_text || '').substring(0, 60)}」`, {
      x: PAGE.MARGIN + 80, y, size: 9, font, color: rgb(0, 0, 0),
    });
    y -= 20;

    // 3プランの該当項目
    const matsuItem = data.plans.matsu?.items?.find(i => i.koji_type === item.koji_type);
    const takeItem  = data.plans.take?.items?.find(i => i.koji_type === item.koji_type);
    const umeItem   = data.plans.ume?.items?.find(i => i.koji_type === item.koji_type);

    y = drawItemPlanRow(page, font, rgb, y, '松', matsuItem, COLORS.lgray);
    y = drawItemPlanRow(page, font, rgb, y, '★竹', takeItem, COLORS.gold);
    y = drawItemPlanRow(page, font, rgb, y, '梅', umeItem, COLORS.lgray);

    y -= 14;  // 項目間スペース
  });

  drawPageFooter(page, font, rgb, data.order_id, 3);
}


function drawItemPlanRow(page, font, rgb, y, label, item, color) {
  if (!item) return y - 14;

  page.drawText(label, {
    x: PAGE.MARGIN + 10, y, size: 9, font, color: rgb(...color),
  });

  const desc = (item.message || item.name || '').substring(0, 50);
  page.drawText(desc, {
    x: PAGE.MARGIN + 45, y, size: 8, font, color: rgb(0.15, 0.15, 0.15),
  });

  const price = item.total ? `¥${item.total.toLocaleString()}` : '';
  page.drawText(price, {
    x: PAGE.A4_W - PAGE.MARGIN - 100, y, size: 9, font, color: rgb(0, 0, 0),
  });

  return y - 14;
}


// ==========================================
// Page 4: 市場警告 & Red Flag
// ==========================================
async function drawWarningsPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '2026年4月 市場警告 / Market Alerts', 4);

  let y = PAGE.A4_H - 110;

  // 市場警告
  if (data.market_alerts.length > 0) {
    page.drawText('▼ 2026年4月 市場影響（業者・施主双方が把握すべき情報）', {
      x: PAGE.MARGIN, y, size: 11, font, color: rgb(...COLORS.red),
    });
    y -= 20;

    data.market_alerts.forEach(alert => {
      if (y < 80) return;

      const color = alert.severity === 'critical' ? COLORS.red : COLORS.orange;

      page.drawRectangle({
        x: PAGE.MARGIN, y: y - 40, width: PAGE.A4_W - PAGE.MARGIN * 2, height: 40,
        color: rgb(1, 0.97, 0.94),
        borderColor: rgb(...color),
        borderWidth: 0.8,
      });

      page.drawText(alert.title, {
        x: PAGE.MARGIN + 10, y: y - 14, size: 10, font, color: rgb(...color),
      });

      const msg = (alert.message || '').substring(0, 100);
      page.drawText(msg, {
        x: PAGE.MARGIN + 10, y: y - 28, size: 8.5, font, color: rgb(0.1, 0.1, 0.1),
      });

      y -= 48;
    });
    y -= 20;
  }

  // Red Flag
  if (Object.keys(data.red_flags_by_category).length > 0) {
    page.drawText('▼ 業界一般的な Red Flag（各カテゴリの注意事項）', {
      x: PAGE.MARGIN, y, size: 11, font, color: rgb(...COLORS.red),
    });
    y -= 20;

    for (const [category, flags] of Object.entries(data.red_flags_by_category)) {
      if (y < 100) break;

      page.drawText(`【${category}】`, {
        x: PAGE.MARGIN, y, size: 9, font, color: rgb(...COLORS.cyan),
      });
      y -= 14;

      flags.slice(0, 3).forEach(flag => {
        if (y < 80) return;
        page.drawText(`・${flag.pattern || flag}`.substring(0, 75), {
          x: PAGE.MARGIN + 15, y, size: 8, font, color: rgb(0.2, 0.2, 0.2),
        });
        y -= 12;
      });
      y -= 6;
    }
  }

  drawPageFooter(page, font, rgb, data.order_id, 4);
}


// ==========================================
// Page 5: 補助金情報
// ==========================================
async function drawSubsidiesPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '利用可能な補助金 / Available Subsidies', 5);

  let y = PAGE.A4_H - 110;

  page.drawText('▼ ご要望の工事内容で利用可能な補助金（取り逃し防止）', {
    x: PAGE.MARGIN, y, size: 11, font, color: rgb(...COLORS.green),
  });
  y -= 24;

  data.subsidies_available.forEach(sub => {
    if (y < 100) return;

    page.drawRectangle({
      x: PAGE.MARGIN, y: y - 60, width: PAGE.A4_W - PAGE.MARGIN * 2, height: 60,
      color: rgb(0.95, 1, 0.95),
      borderColor: rgb(...COLORS.green),
      borderWidth: 0.5,
    });

    page.drawText(sub.name, {
      x: PAGE.MARGIN + 10, y: y - 16, size: 11, font, color: rgb(...COLORS.green),
    });

    page.drawText(`所管: ${sub.所管 || sub.shokan || '—'}`, {
      x: PAGE.MARGIN + 10, y: y - 32, size: 8, font, color: rgb(...COLORS.gray),
    });

    const amount = sub.金額目安 || sub.amount || '';
    page.drawText(`金額: ${amount}`, {
      x: PAGE.MARGIN + 10, y: y - 46, size: 9, font, color: rgb(0, 0, 0),
    });

    y -= 70;
  });

  y -= 10;
  const note = [
    '※ 補助金は申請期限・予算上限・対象工事条件があります。',
    '※ 多くの制度で事前申請（着工前申請）が必須です。',
    '※ 自治体独自の補助金も併用可能な場合があります。',
    '※ 詳細は各制度の公式サイトをご確認ください。',
  ];
  note.forEach((line, i) => {
    page.drawText(line, {
      x: PAGE.MARGIN, y: y - (i * 14), size: 8, font, color: rgb(...COLORS.gray),
    });
  });

  drawPageFooter(page, font, rgb, data.order_id, 5);
}


// ==========================================
// Page 6: 業者交渉テンプレート
// ==========================================
async function drawNegotiationTemplatePage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '業者交渉 テンプレート / Negotiation Template', 6);

  let y = PAGE.A4_H - 110;

  page.drawText('▼ 業者様にそのまま提示できる交渉文面（コピペ可）', {
    x: PAGE.MARGIN, y, size: 11, font, color: rgb(...COLORS.cyan),
  });
  y -= 24;

  // テンプレート本文（Box）
  const takePrice = data.plans.take?.total || 0;
  const takeManEn = data.plans.take?.total_man_en || 0;

  const boxH = 240;
  page.drawRectangle({
    x: PAGE.MARGIN, y: y - boxH, width: PAGE.A4_W - PAGE.MARGIN * 2, height: boxH,
    color: rgb(0.98, 0.99, 1.00),
    borderColor: rgb(...COLORS.cyan),
    borderWidth: 0.5,
  });

  const templateLines = [
    'お世話になっております。',
    '',
    '下記の工事についてお見積もりをお願いいたします。',
    'HORIZON SHIELD（第三者機関）による相場分析レポートを',
    '参考資料として同封いたします。',
    '',
    '【希望内容】',
    ...data.extracted_items.slice(0, 4).map(it => `・${it.raw_text}`),
    '',
    '【予算感（市場相場に基づく参考）】',
    `中小工務店の妥当利益率レンジ相当（${takeManEn}万円前後）を想定`,
    '',
    '【ご相談事項】',
    '御社のお見積もりが上記と異なる場合、理由をご説明いただけると',
    '大変助かります（現場条件・グレード差・工法差など）。',
    '',
    '※ 本紙は建設業法上の見積書ではなく、参考情報です。',
  ];

  templateLines.forEach((line, i) => {
    page.drawText(line, {
      x: PAGE.MARGIN + 14, y: y - 18 - (i * 12),
      size: 8.5, font, color: rgb(0.1, 0.1, 0.1),
    });
  });

  y -= boxH + 20;

  // 使い方のヒント
  page.drawText('▼ 活用のコツ', {
    x: PAGE.MARGIN, y, size: 10, font, color: rgb(...COLORS.gold),
  });
  y -= 18;

  const tips = [
    '1. 本書をメール/郵送で業者様に事前送付すると、交渉がスムーズです',
    '2. 「相場より高い、安くしろ」ではなく、「違う理由を教えて」という姿勢で',
    '3. 3社以上の相見積もりと併せて使うと効果絶大',
    '4. 業者様が正当な理由で相場より高い見積もりを出すケースもあります',
  ];
  tips.forEach((tip, i) => {
    page.drawText(tip, {
      x: PAGE.MARGIN + 10, y: y - (i * 14), size: 8.5, font, color: rgb(...COLORS.gray),
    });
  });

  drawPageFooter(page, font, rgb, data.order_id, 6);
}


// ==========================================
// Page 7: 法的免責事項
// ==========================================
async function drawLegalDisclaimerPage(pdfDoc, font, rgb, data) {
  const page = pdfDoc.addPage([PAGE.A4_W, PAGE.A4_H]);

  drawPageHeader(page, font, rgb, '法的免責事項 / Legal Notice', 7);

  let y = PAGE.A4_H - 110;

  // 重要警告バー
  page.drawRectangle({
    x: PAGE.MARGIN, y: y - 30, width: PAGE.A4_W - PAGE.MARGIN * 2, height: 30,
    color: rgb(1, 0.93, 0.93),
    borderColor: rgb(...COLORS.red),
    borderWidth: 1,
  });
  page.drawText('【重要】本書は建設業法上の正式見積書ではありません', {
    x: PAGE.MARGIN + 12, y: y - 20,
    size: 11, font, color: rgb(...COLORS.red),
  });

  y -= 48;

  const disclaimers = [
    '1. 本書は国土交通省・建設物価調査会・メーカー公式カタログ等の公開データに基づき',
    '   AIが算出した「市場相場の参考価格分析」です。建設業法上の正式な見積書ではありません。',
    '',
    '2. 本書の発行者 The HORIZ音s株式会社（以下HS）は、建設工事の施工・請負・仲介を',
    '   一切行いません。施主様と施工業者様の契約関係にHSは介在しません。',
    '',
    '3. 本書に記載の金額は2026年4月時点の相場レンジであり、実際の工事金額は',
    '   施工業者・時期・地域・現場条件により変動します。',
    '',
    '4. 本書は施工業者様との交渉における参考資料としてご活用ください。',
    '   施工業者様との正式な契約・見積書は、別途施工業者様から取得してください。',
    '',
    '5. 本書の内容に起因する損害について、HSは一切の責任を負いません。',
    '   また、本書を根拠とした業者様への一方的な値下げ要求はご遠慮ください。',
    '',
    '6. 本書の著作権はThe HORIZ音s株式会社に帰属します。',
    '   無断転載・二次配布・AIへの学習利用を禁じます。',
    '',
    '7. 本サービスはデジタルコンテンツの性質上、購入後の返品・返金には応じられません。',
    '   明らかなシステム不具合による内容誤り等はメール連絡で対応いたします。',
  ];

  disclaimers.forEach((line, i) => {
    page.drawText(line, {
      x: PAGE.MARGIN, y: y - (i * 14),
      size: 9, font, color: rgb(0.1, 0.1, 0.1),
    });
  });

  // フッター
  y = 140;
  page.drawLine({
    start: { x: PAGE.MARGIN, y }, end: { x: PAGE.A4_W - PAGE.MARGIN, y },
    thickness: 0.5, color: rgb(...COLORS.gray),
  });

  const footLines = [
    'The HORIZ音s株式会社 / HORIZON SHIELD',
    '所在地: 神奈川県平塚市東真土1-1-47 GH湘南2（建設部拠点）',
    '代表者: 大賀 俊勝',
    '特定商取引法に基づく表記: https://shield.the-horizons-innovation.com/tokusho',
    'お問い合わせ: kira@the-horizons-innovation.com / LINE @172piime',
  ];
  footLines.forEach((line, i) => {
    page.drawText(line, {
      x: PAGE.MARGIN, y: y - 20 - (i * 12),
      size: 8, font, color: rgb(...COLORS.gray),
    });
  });

  drawPageFooter(page, font, rgb, data.order_id, 7);
}


// ==========================================
// ユーティリティ: ページヘッダー・フッター
// ==========================================
function drawPageHeader(page, font, rgb, title, pageNum) {
  page.drawRectangle({
    x: 0, y: PAGE.A4_H - 60, width: PAGE.A4_W, height: 60,
    color: rgb(...COLORS.bg),
  });

  page.drawText('HORIZ音S / SHIELD', {
    x: PAGE.MARGIN, y: PAGE.A4_H - 30,
    size: 9, font, color: rgb(...COLORS.gold),
  });

  page.drawText(title, {
    x: PAGE.MARGIN, y: PAGE.A4_H - 48,
    size: 11, font, color: rgb(...COLORS.cyan),
  });

  page.drawText(`p.${pageNum}`, {
    x: PAGE.A4_W - PAGE.MARGIN - 40, y: PAGE.A4_H - 30,
    size: 9, font, color: rgb(...COLORS.cyan),
  });
}


function drawPageFooter(page, font, rgb, orderId, pageNum) {
  const y = 40;
  page.drawLine({
    start: { x: PAGE.MARGIN, y },
    end: { x: PAGE.A4_W - PAGE.MARGIN, y },
    thickness: 0.3,
    color: rgb(...COLORS.lgray),
  });

  page.drawText(`参考見積書 / ${orderId}`, {
    x: PAGE.MARGIN, y: y - 14,
    size: 7, font, color: rgb(...COLORS.gray),
  });

  page.drawText('本書は建設業法上の正式見積もりではありません', {
    x: PAGE.A4_W / 2 - 90, y: y - 14,
    size: 7, font, color: rgb(...COLORS.red),
  });

  page.drawText(`p.${pageNum}`, {
    x: PAGE.A4_W - PAGE.MARGIN - 20, y: y - 14,
    size: 7, font, color: rgb(...COLORS.gray),
  });
}


function drawLabelValue(page, font, rgb, x, y, label, value, size) {
  page.drawText(label, {
    x, y, size: size - 2, font, color: rgb(...COLORS.gray),
  });
  page.drawText(value || '—', {
    x: x + 80, y, size, font, color: rgb(0, 0, 0),
  });
}


// ==========================================
// ユーティリティ
// ==========================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}


function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${dd}日`;
}


function bufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}


/*
==========================================
【デプロイ手順】
==========================================

1. Cloudflare Workers ダッシュボードで Worker 名: hs-pdf-gen を作成（既存を更新）
2. 本ファイル内容を全てコピー → index.js に貼付け
3. wrangler.toml に以下を設定:

   ```toml
   name = "hs-pdf-gen"
   main = "index.js"
   compatibility_date = "2026-04-19"

   [[r2_buckets]]
   binding = "HS_PDFS"
   bucket_name = "hs-pdfs"

   [[kv_namespaces]]
   binding = "ORDERS"
   id = "700d6bc31fe9460db1ee5dba36ca622c"
   ```

4. npm install pdf-lib @pdf-lib/fontkit してバンドルを同梱
   （または esbuild でシングルファイル化）

5. デプロイ: wrangler deploy

6. カスタムドメイン: hs-pdf-gen.the-horizons-innovation.com を追加（任意）
7. R2 バインド hs-pdfs を public access ドメインに設定

==========================================
【widget.html v3 からの呼び出し例】
==========================================

async function generateReferenceEstimate(data) {
  const res = await fetch('https://hs-pdf-gen.oga-surf-project.workers.dev/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: crypto.randomUUID(),
      user: { name: '...', email: '...' },
      extracted_items: [...],     // reverse-estimate の結果
      plans: {...},               // reverse-estimate の結果
      market_alerts: [...],
      red_flags_by_category: {},  // オプション
      subsidies_available: [],    // オプション
    }),
  });
  const json = await res.json();
  return json.pdf_url;  // ブラウザで開いてダウンロード
}
*/
