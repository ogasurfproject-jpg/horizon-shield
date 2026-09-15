# -*- coding: utf-8 -*-
"""共通部品: souba-db の正値、直答ブロックの生成、FAQ の JSON-LD 再生成、検査。
   数字は全部 souba-db 2.2.0 (2026-08-17、sha 85418e4a...) から。ページに危険水準の新しい数字は足さない。"""
import json, re, html

DB = json.load(open('souba-db.json', encoding='utf-8'))
CAT = {c['id']: c for c in DB['categories']}
DB_VER = DB['_meta']['version']
DB_DATE = DB['_meta']['updated_at']
TODAY = '2026-09-15'

def man(n):
    """円 → 万円表記。150000 → 15、1150000 → 115、99000 → 9.9"""
    v = n / 10000.0
    return ('%d' % v) if abs(v - round(v)) < 1e-9 else ('%.1f' % v)

def rng(cid):
    c = CAT[cid]
    return '%s〜%s万円' % (man(c['min']), man(c['max']))

def rng_avg(cid):
    c = CAT[cid]
    return '%s〜%s万円(平均%s万円)' % (man(c['min']), man(c['max']), man(c['avg']))

def yen(n):
    return '{:,}円'.format(n)

def sqm(cid):
    c = CAT[cid]
    return '%s〜%s円/㎡' % ('{:,}'.format(c['min']), '{:,}'.format(c['max']))

SRC_LINE = ('数字の出どころ: HORIZON SHIELD souba-db %s(%s 更新、建設実務30年 大賀俊勝 監修)。同じ数字は '
            '<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> と MCP ツール get_price_range で誰でも引けるので、'
            '第三者が同じ表を作り直せます。業者からの紹介料・掲載料・成約料は受け取っていません。') % (DB_VER, DB_DATE)

def table(rows, head, cls='price-table', caption=None):
    out = ['<table class="%s"%s>' % (cls, '' if cls else ' border="1"')]
    if caption:
        out.append('<caption>%s</caption>' % caption)
    out.append('<tr>' + ''.join('<th>%s</th>' % h for h in head) + '</tr>')
    for r in rows:
        out.append('<tr>' + ''.join('<td>%s</td>' % c for c in r) + '</tr>')
    out.append('</table>')
    return '\n'.join(out)

def steps_block(lines, heading='自分で確かめる 3 手順'):
    return '<h3>%s</h3>\n<ol>\n%s\n</ol>' % (heading, '\n'.join('<li>%s</li>' % l for l in lines))

def bands_block(lo_avg, avg_max, over, heading='この金額は高い？ 3 つの目安'):
    return ('<h3>%s</h3>\n<ul>\n<li><strong>最安〜平均:</strong> %s</li>\n<li><strong>平均〜最高:</strong> %s</li>\n'
            '<li><strong>最高を超える:</strong> %s</li>\n</ul>') % (heading, lo_avg, avg_max, over)

def faq_items_from_page(s):
    """souba-v2 型ページの .faq-item を (q, a) で拾う"""
    items = re.findall(r'<div class="faq-item"><p class="q">(.*?)</p><p class="a">(.*?)</p></div>', s, re.S)
    return [(strip(q), strip(a)) for q, a in items]

def faq_items_from_generated(s):
    items = re.findall(r"<div class='qa'><h3 class='q'>(.*?)</h3><div class='a'><p>(.*?)</p></div></div>", s, re.S)
    return [(strip(q), strip(a)) for q, a in items]

def strip(x):
    return html.unescape(re.sub(r'<[^>]+>', '', x)).strip()

def faq_ld(items):
    return json.dumps({"@context": "https://schema.org", "@type": "FAQPage",
                       "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in items]},
                      ensure_ascii=False)

def replace_faq_ld(s, items):
    """head の FAQPage JSON-LD を items で置換(1 個だけある前提。無ければ最初の ld+json の前に足す)"""
    pat = re.compile(r'<script type="application/ld\+json">\s*(\{[^<]*?"@type":\s*"FAQPage".*?\})\s*</script>', re.S)
    m = pat.search(s)
    new = '<script type="application/ld+json">\n' + faq_ld(items) + '\n</script>'
    if m:
        return s[:m.start()] + new + s[m.end():], True
    i = s.find('<script type="application/ld+json">')
    return s[:i] + new + '\n' + s[i:], False

def faq_item_html(q, a):
    return '<div class="faq-item"><p class="q">%s</p><p class="a">%s</p></div>' % (q, a)

def faq_item_gen(q, a):
    return "<div class='qa'><h3 class='q'>%s</h3><div class='a'><p>%s</p></div></div>" % (q, a)

BANNED = re.compile('[\\u2013\\u2014\\u2015\\u2500]')

def check_page(path, s):
    problems = []
    if BANNED.search(s):
        for i, l in enumerate(s.split('\n'), 1):
            if BANNED.search(l):
                problems.append('dash line %d: %s' % (i, l.strip()[:80]))
    for m in re.finditer(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', s, re.S):
        try:
            json.loads(m.group(1))
        except Exception as e:
            problems.append('ld+json parse: %s' % e)
    if s.count('<h1') != 1:
        problems.append('h1 count %d' % s.count('<h1'))
    for w in ('souba-v2 JSON', 'horizon_shield_standard', 'red_flags)', 'negotiation_tips', 'business_size_based_pricing', 'v2_to_v3_changes', 'v3_to_v3_1_changes', 'horizons_philosophy', 'TOshi哲学'):
        if w in s:
            problems.append('jargon still present: %s' % w)
    return problems

def must(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        raise SystemExit('replace failed (%d found, want %d): %s' % (n, count, old[:90]))
    return s.replace(old, new)
