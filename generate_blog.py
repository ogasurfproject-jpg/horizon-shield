import os, json, urllib.request, datetime, time

TOPICS = [
    'リフォーム見積もりで100万円以上損する人の共通点',
    '屋根修理の相場と悪徳業者の見分け方',
    '外壁塗装で絶対にやってはいけない3つの失敗',
    '床下工事の適正価格と過剰請求の実例',
    'シロアリ駆除の見積もりが高すぎる理由',
    '新築住宅の建設費で削れる項目ランキング',
    '工務店の追加費用請求は正当か確認方法を解説',
    '建設業法が定める見積書のルールを知っていますか',
    'リフォーム詐欺の手口と対策完全ガイド',
    '建設費診断で350万円削減できた実例',
    '見積書の数字をAIで30秒チェックする方法',
    '住宅ローンを組む前に建設費を見直すべき理由',
    '完成検査で発覚した施工不良の実例集',
    '変更工事費用の適正価格チェックリスト',
    '建設会社との交渉で使える5つのフレーズ',
]

topic = os.environ.get('TOPIC', '').strip()
if not topic:
    topic = TOPICS[int(time.time() / 86400) % len(TOPICS)]

date_str = datetime.date.today().isoformat()
slug = 'article-' + date_str

api_key = os.environ['ANTHROPIC_API_KEY']
req_data = json.dumps({
    'model': 'claude-haiku-4-5-20251001',
    'max_tokens': 1500,
    'messages': [{'role': 'user', 'content': '建設費診断の専門家として「' + topic + '」というテーマでブログ記事を書いてください。条件：800〜1200文字、h2とpタグのみ使用、具体的な数字と事例を入れる、最後に「見積書が気になる方はLINEで無料診断ができます」と書く。'}]
}).encode('utf-8')

req = urllib.request.Request(
    'https://api.anthropic.com/v1/messages',
    data=req_data,
    headers={'Content-Type': 'application/json', 'x-api-key': api_key, 'anthropic-version': '2023-06-01'}
)
with urllib.request.urlopen(req) as r:
    content = json.loads(r.read())['content'][0]['text']

os.makedirs('blog', exist_ok=True)

article_html = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + topic + ' | HORIZON SHIELD</title>\n<style>\nbody{font-family:sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0}\n.container{max-width:800px;margin:0 auto;padding:40px 20px}\nh1{font-size:28px;color:#fff;line-height:1.4;margin:20px 0}\n.date{color:#888;font-size:14px;margin-bottom:30px}\nh2{font-size:20px;color:#f97316;border-left:4px solid #f97316;padding-left:12px;margin:32px 0 16px}\np{line-height:1.8;margin-bottom:20px;color:#ccc}\n.cta{background:#1a1a1a;border:1px solid #f97316;border-radius:12px;padding:30px;margin:40px 0;text-align:center}\n.cta-title{color:#f97316;font-weight:bold;font-size:18px;margin-bottom:16px}\n.cta a{display:inline-block;background:#06c755;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}\nfooter{text-align:center;padding:40px 0;color:#555;font-size:12px;border-top:1px solid #222;margin-top:60px}\nfooter a{color:#f97316;text-decoration:none}\n</style>\n</head>\n<body>\n<div class="container">\n<a href="https://shield.the-horizons-innovation.com" style="color:#f97316;text-decoration:none;font-size:14px">← HORIZON SHIELDトップへ</a>\n<h1>' + topic + '</h1>\n<div class="date">' + date_str + ' | 建設費診断専門家 大賀俊勝</div>\n<article>\n' + content + '\n</article>\n<div class="cta">\n<p class="cta-title">あなたの見積書、無料で診断します</p>\n<a href="https://line.me/R/ti/p/@172piime">LINEで無料相談する</a>\n</div>\n<footer>\n<a href="https://shield.the-horizons-innovation.com">HORIZON SHIELD</a> | \n<a href="https://shield.the-horizons-innovation.com/blog/">ブログ一覧</a><br><br>\n2026 The HORIZONs\n</footer>\n</div>\n</body>\n</html>'

with open('blog/' + slug + '.html', 'w', encoding='utf-8') as f:
    f.write(article_html)

index_file = 'blog/index.json'
if os.path.exists(index_file):
    with open(index_file, encoding='utf-8') as f:
        index = json.load(f)
else:
    index = {'articles': []}

index['articles'] = [a for a in index['articles'] if a.get('slug') != slug]
index['articles'].insert(0, {'slug': slug, 'title': topic, 'date': date_str, 'url': '/blog/' + slug + '.html'})
index['articles'] = index['articles'][:30]

with open(index_file, 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)

items = ''.join(['<li><a href="https://shield.the-horizons-innovation.com' + a['url'] + '">' + a['title'] + '</a><span style="color:#666;font-size:13px"> ' + a['date'] + '</span></li>' for a in index['articles']])

blog_index = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>建設費リフォーム情報ブログ | HORIZON SHIELD</title>\n<style>\nbody{font-family:sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0}\n.container{max-width:800px;margin:0 auto;padding:40px 20px}\nh1{font-size:24px;color:#fff;margin-bottom:8px}\n.subtitle{color:#888;margin-bottom:40px}\nul{list-style:none;padding:0}\nli{border-bottom:1px solid #222;padding:20px 0}\na{color:#e0e0e0;text-decoration:none;font-size:16px;font-weight:bold;display:block;margin-bottom:4px}\na:hover{color:#f97316}\n</style>\n</head>\n<body>\n<div class="container">\n<a href="https://shield.the-horizons-innovation.com" style="color:#f97316;text-decoration:none;font-size:14px;display:block;margin-bottom:30px">← トップへ戻る</a>\n<h1>建設費・リフォーム情報ブログ</h1>\n<p class="subtitle">建設費診断の専門家が、見積もりの適正価格や悪徳業者の手口を解説します</p>\n<ul>' + items + '</ul>\n</div>\n</body>\n</html>'

with open('blog/index.html', 'w', encoding='utf-8') as f:
    f.write(blog_index)

print('SUCCESS: ' + slug + ' - ' + topic)
