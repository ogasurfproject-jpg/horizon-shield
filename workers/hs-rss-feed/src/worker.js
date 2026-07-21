export default {
  async fetch(request) {
    const url = 'https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/blog/index.json';
    
    const res = await fetch(url);
    if (!res.ok) {
      return new Response('Failed to fetch index', { status: 502 });
    }
    
    const data = await res.json();
    const articles = data.articles || [];
    
    const items = articles.map(a => {
      const link = 'https://shield.the-horizons-innovation.com' + a.url;
      return `
    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
      <description><![CDATA[${a.title} | HORIZON SHIELD 建設費診断]]></description>
    </item>`;
    }).join('');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>HORIZON SHIELD 建設費診断ブログ</title>
    <link>https://shield.the-horizons-innovation.com/blog/</link>
    <description>建設費・リフォーム費用の適正価格と悪徳業者対策</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

    return new Response(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=3600',
      }
    });
  }
};