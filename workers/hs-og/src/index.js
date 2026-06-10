import { ImageResponse } from 'workers-og';
import fontData from './wanted-font.ttf';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let id = '';
    const m = url.pathname.match(/\/hacker\/wanted\/([^\/]+)\/og\.png$/);
    if (m) id = decodeURIComponent(m[1]);
    if (!id) id = url.searchParams.get('id') || '';

    let c = null;
    if (id) {
      try {
        const raw = await env.ORDERS.get('card:' + id);
        if (raw) { const p = JSON.parse(raw); if (p.published !== false) c = p; }
      } catch (e) {}
    }
    if (!c) {
      c = { genre: 'その他', amount: '929500', red_flags: 5, traits: ['型枠工事が複数項目で一式表記、内訳不明'] };
    }

    const genre = esc(c.genre || 'その他');
    const amountNum = (c.amount != null ? String(c.amount) : '').replace(/[^0-9]/g, '');
    const amountStr = amountNum ? ('\u00a5' + Number(amountNum).toLocaleString('en-US')) : '';
    const redFlags = Number(c.red_flags) || 0;
    let topTrait = (Array.isArray(c.traits) && c.traits.length) ? String(c.traits[0]) : '';
    if (topTrait.length > 20) topTrait = topTrait.slice(0, 20) + '…';
    topTrait = esc(topTrait);

    const INK = '#152038';
    const RED = '#A8331F';
    const PAPER = '#EDE8DC';

    const row = 'display:flex;width:100%;justify-content:center;flex-shrink:0;';

    // 赤旗(ポール+なびく旗布)。旗布の右端をborderトリックで三角に切る。
    const flag =
      '<div style="display:flex;align-items:flex-start;flex-shrink:0;">' +
        '<div style="display:flex;width:5px;height:54px;background:' + INK + ';flex-shrink:0;"></div>' +
        '<div style="display:flex;align-items:center;height:38px;background:' + RED + ';padding:0 14px 0 12px;flex-shrink:0;color:' + PAPER + ';font-size:24px;">容疑 ' + redFlags + ' 件</div>' +
        '<div style="display:flex;width:0;height:0;flex-shrink:0;border-top:19px solid transparent;border-bottom:19px solid transparent;border-left:18px solid ' + RED + ';"></div>' +
      '</div>';

    let inner =
      '<div style="display:flex;width:100%;justify-content:space-between;align-items:center;flex-shrink:0;">' +
        '<div style="display:flex;font-size:28px;color:' + RED + ';">過剰請求</div>' +
        '<div style="display:flex;width:84px;height:84px;flex-shrink:0;border:3px solid ' + RED + ';border-radius:42px;align-items:center;justify-content:center;color:' + RED + ';font-size:24px;">KIRA</div>' +
      '</div>' +
      '<div style="' + row + 'margin-top:6px;"><div style="display:flex;font-size:88px;color:' + INK + ';">御指名手配</div></div>' +
      '<div style="' + row + 'margin-top:18px;"><div style="display:flex;font-size:20px;color:' + RED + ';">請求ノ分野</div></div>' +
      '<div style="' + row + 'margin-top:4px;"><div style="display:flex;font-size:40px;color:' + INK + ';">' + genre + '</div></div>' +
      '<div style="' + row + 'margin-top:14px;"><div style="display:flex;font-size:20px;color:' + RED + ';">申し受け候</div></div>' +
      '<div style="' + row + 'margin-top:2px;"><div style="display:flex;font-size:64px;color:' + RED + ';">' + amountStr + '</div></div>';

    if (redFlags > 0) {
      inner += '<div style="' + row + 'margin-top:14px;">' + flag + '</div>';
    }
    if (topTrait) {
      inner += '<div style="' + row + 'margin-top:12px;"><div style="display:flex;font-size:20px;color:' + INK + ';">容疑筆頭：' + topTrait + '</div></div>';
    }

    const html =
      '<div style="display:flex;width:1200px;height:630px;align-items:center;justify-content:center;background:' + PAPER + ';font-family:wanted;">' +
        '<div style="display:flex;flex-direction:column;width:1080px;align-items:center;justify-content:center;padding:36px 60px;border:5px solid ' + RED + ';">' +
          inner +
        '</div>' +
      '</div>';

    return new ImageResponse(html, {
      width: 1200,
      height: 630,
      fonts: [ { name: 'wanted', data: fontData, weight: 400, style: 'normal' } ],
    });
  },
};
