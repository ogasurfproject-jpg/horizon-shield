// US-D-davis-bacon: SAM.gov の賃金決定を取った pageFunction(apify/website-content-crawler、crawlerType playwright:chrome、
// startUrls = https://sam.gov/wage-determination/CA20260001/3?claude_batch=<k>、keepElementsCssSelector #claude-out、htmlTransformer none、
// requestTimeoutSecs 600)。k 番目の一覧の頁(250 件、sort=title)と、その頁の決定の wdol/v1/wd/<WD>/<改訂> を頁の中から fetch() し、
// 応答のバイト列を sha256 し、gzip + base64 にして <pre id=claude-out> に書く。受け取りは tools/parsers/dbra_unpack.py。
// 注意: SAM.gov の利用規約は "Automated data gathering, web scraping tools are prohibited" と書く(reports/US-D-davis-bacon.md)。
// 2026-09-26 は batch 0-8 を取った所で止めた。番人の判断なしに再実行しない。
async function pageFunction({ page }) {
  const k = parseInt(new URL(page.url()).searchParams.get('claude_batch') || '0');
  await page.waitForTimeout(2000);
  const res = await page.evaluate(async (k) => {
    const SIZE = 250;
    const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const sha = async (u8) => hex(await crypto.subtle.digest('SHA-256', u8));
    const keep = ['content-type', 'date', 'last-modified', 'etag', 'content-length', 'x-cache'];
    const get = async (url) => {
      for (let a = 0; a < 3; a++) {
        try {
          const r = await fetch(url, { credentials: 'include' });
          const b = new Uint8Array(await r.arrayBuffer());
          const h = {}; r.headers.forEach((v, kk) => { if (keep.includes(kk)) h[kk] = v; });
          if (r.status === 200 || a === 2) return { url, status: r.status, headers: h, bytes: b };
        } catch (e) { if (a === 2) return { url, status: -1, err: String(e), bytes: new Uint8Array(0) }; }
        await new Promise(r => setTimeout(r, 1500));
      }
    };
    const items = [];
    const L = await get('https://sam.gov/api/prod/sgs/v1/search/?index=dbra&mode=search&responseType=json&is_active=true&size=' + SIZE + '&page=' + k + '&sort=title');
    items.push(L);
    let list = [];
    try { list = JSON.parse(new TextDecoder().decode(L.bytes))._embedded.results.map(x => [x.fullReferenceNumber, x.revisionNumber]); } catch (e) {}
    if (k === 0) { items.push(await get('https://sam.gov/api/prod/wdol/v1/dictionaries?api_key=null&ids=wdStates,wdCounties')); }
    const urls = list.map(x => 'https://sam.gov/api/prod/wdol/v1/wd/' + x[0] + '/' + x[1] + '?api_key=null');
    let idx = 0; const out = new Array(urls.length);
    const worker = async () => { while (idx < urls.length) { const i = idx++; out[i] = await get(urls[i]); } };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    for (const o of out) items.push(o);
    let total = 0; for (const it of items) total += it.bytes.length;
    const buf = new Uint8Array(total); let off = 0; const index = [];
    for (const it of items) { buf.set(it.bytes, off); index.push({ url: it.url, status: it.status, headers: it.headers, err: it.err, off: off, len: it.bytes.length, sha256: await sha(it.bytes) }); off += it.bytes.length; }
    const gz = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let s = ''; const CH = 0x8000; for (let i = 0; i < gz.length; i += CH) { s += String.fromCharCode.apply(null, gz.subarray(i, i + CH)); }
    const meta = { batch: k, n: items.length, total: total, gzlen: gz.length, gzsha256: await sha(gz), fetched_at: new Date().toISOString(), index: index };
    const pre = document.createElement('pre'); pre.id = 'claude-out';
    pre.textContent = JSON.stringify(meta) + ' @@B64@@ ' + btoa(s) + ' @@END@@';
    document.body.appendChild(pre);
    return { k: k, n: items.length, total: total, gz: gz.length };
  }, k);
  return res;
}
